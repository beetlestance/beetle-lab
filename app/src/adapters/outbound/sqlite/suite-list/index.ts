import type { DatabaseSync } from 'node:sqlite';
import {
  encodeSuiteListCursor,
  normalizeSuiteListQuery,
  suiteListPageMatches,
  suiteListPosition,
} from '@beetle/contracts/api';
import type { NormalizedSuiteListQuery, SuiteListPosition, SuitePage, WorkspaceScope } from '@beetle/contracts/api';
import type { SuiteList } from '../../../../ports/suites.js';
import { requireRule } from '../../../../domain/namespaces/index.js';
import { StorageError } from '../protocol.js';
import { normalizedScope } from '../suites.js';
import type { Suites } from '../suites.js';
import { transaction } from '../transaction.js';
import { matchingSuiteNames, prepareNameSearch } from '../run-search/index.js';
import { latestRunHeader } from './latest-run.js';
import {
  captureSuiteKey,
  compareSuiteKeys,
  follows,
  publicGroup,
  storedGroups,
  suiteGroupStatement,
  suiteKeyByIdSql,
} from './statements.js';
import type { SuiteAfter, SuiteKey } from './statements.js';
export { folderSummaries } from './folders.js';
export { suiteGroupStatement, storedGroups } from './statements.js';

function bound(input: SuiteList): {
  scope: WorkspaceScope;
  query: NormalizedSuiteListQuery;
  position: SuiteListPosition | null;
} {
  const { scope: owner, ...page } = input;
  const scope = normalizedScope(owner);
  try {
    const query = normalizeSuiteListQuery(page);
    return { scope, query, position: suiteListPosition(scope, query) };
  } catch {
    throw new StorageError('invalid_input');
  }
}
/** Folder-first suite page: stored latest-Run state, per-group index keysets merged in one read transaction. */
export class SuiteListReads {
  constructor(
    private readonly db: DatabaseSync,
    private readonly suites: Suites,
  ) {}
  list(input: SuiteList): SuitePage {
    const { scope, query, position } = bound(input);
    if (query.name !== undefined) {
      this.suites.workspace(scope);
      prepareNameSearch(this.db, scope);
    }
    return transaction(this.db, () => {
      this.suites.workspace(scope);
      if (query.folderId !== undefined) this.folder(scope, query.folderId);
      const after = this.after(scope, query, position);
      const keys = query.name === undefined ? this.indexed(scope, query, after) : this.searched(scope, query, after);
      const selected = keys.slice(0, query.limit);
      const items = selected.map((key) => this.suites.getSuite({ scope, id: key.id }));
      const summaries = selected.map((key, index) => ({
        suiteId: key.id,
        engineId: items[index]!.currentRevisionId === null ? null : ('k6' as const),
        group: publicGroup(key.latest_group),
        latestRun: latestRunHeader(this.db, scope, key),
      }));
      const last = selected.at(-1);
      const requestedAt = query.order === 'name' || !last?.latest_requested_at ? null : last.latest_requested_at;
      const nextCursor =
        keys.length > query.limit && last ? encodeSuiteListCursor({ scope, query, requestedAt, id: last.id }) : null;
      const result = { scope, items, summaries, nextCursor };
      if (!suiteListPageMatches(result, scope, query)) throw new Error('Invalid persisted suite page');
      return result;
    });
  }
  private folder(scope: WorkspaceScope, id: string): void {
    const row = this.db
      .prepare('SELECT 1 AS found FROM folders WHERE organization_id=? AND workspace_id=? AND id=?')
      .get(scope.organizationId, scope.workspaceId, id);
    requireRule(row !== undefined, 'not_found');
  }
  private key(scope: WorkspaceScope, id: string): SuiteKey | undefined {
    const row = this.db.prepare(suiteKeyByIdSql).get(scope.organizationId, scope.workspaceId, id);
    return row === undefined ? undefined : captureSuiteKey(row);
  }
  /** Name order keeps only the last UUID in the cursor; its folded name is re-read here (suites are never deleted). */
  private after(
    scope: WorkspaceScope,
    query: NormalizedSuiteListQuery,
    position: SuiteListPosition | null,
  ): SuiteAfter | null {
    if (position === null) return null;
    if (query.order === 'recent_run')
      return { order: 'recent_run', requestedAt: position.requestedAt ?? '', id: position.id };
    const key = this.key(scope, position.id);
    if (key === undefined) throw new StorageError('invalid_input');
    return { order: 'name', folded: key.folded_name, id: key.id };
  }
  private indexed(scope: WorkspaceScope, query: NormalizedSuiteListQuery, after: SuiteAfter | null): SuiteKey[] {
    let merged: SuiteKey[] = [];
    for (const group of storedGroups(query)) {
      const statement = suiteGroupStatement(scope, query, group, after);
      const rows = this.db
        .prepare(statement.sql)
        .all(...statement.values)
        .map(captureSuiteKey);
      merged = [...merged, ...rows].sort((a, b) => compareSuiteKeys(query.order, a, b)).slice(0, query.limit + 1);
    }
    return merged;
  }
  /** At most 256 verified suite postings, each one primary-key read, then filtered and ordered in memory. */
  private searched(scope: WorkspaceScope, query: NormalizedSuiteListQuery, after: SuiteAfter | null): SuiteKey[] {
    const groups = new Set(storedGroups(query));
    const keys: SuiteKey[] = [];
    for (const id of matchingSuiteNames(this.db, scope, query.name!)) {
      const key = this.key(scope, id);
      if (key === undefined) throw new StorageError('unavailable');
      if (!groups.has(key.latest_group) || !follows(after, key)) continue;
      if (query.folderId !== undefined && key.folder_id !== query.folderId) continue;
      keys.push(key);
    }
    return keys.sort((a, b) => compareSuiteKeys(query.order, a, b)).slice(0, query.limit + 1);
  }
}
