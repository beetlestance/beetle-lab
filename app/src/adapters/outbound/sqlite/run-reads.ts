import { captureRunRow, runColumns } from './run-row.js';
import { readHistorySummaries } from './run-history/index.js';
import { readRunAnnotations } from './run-annotations.js';
import type { DatabaseSync } from 'node:sqlite';
import { encodeRunListCursor, normalizeRunListQuery, runListPageMatches, runListPosition } from '@beetle/contracts/api';
import type { Run, RunPage } from '@beetle/contracts/api';
import type { RunKey, RunList } from '../../../ports/runs.js';
import { requireRule } from '../../../domain/namespaces/index.js';
import { lower } from './input-values.js';
import { normalizedScope } from './suites.js';
import type { Suites } from './suites.js';
import { prepareHistorySearch, historyKeys } from './run-search/index.js';
import { transaction } from './transaction.js';
import { runPinnedAt } from './run-pins/state.js';
import { readRunListContexts } from './run-list-context.js';

export class RunReads {
  constructor(
    private readonly db: DatabaseSync,
    private readonly suites: Suites,
  ) {}
  get(key: RunKey): Run {
    const scope = normalizedScope(key.scope);
    const row = this.db
      .prepare(`SELECT ${runColumns} FROM runs WHERE organization_id=? AND workspace_id=? AND id=?`)
      .get(scope.organizationId, scope.workspaceId, lower(key.id));
    requireRule(row !== undefined, 'not_found');
    const owner = { id: lower(key.id), scope, activeAttemptId: String(row.active_attempt_id) };
    const run = captureRunRow(row, { scope, id: key.id }, readRunAnnotations(this.db, owner));
    const pinnedAt = runPinnedAt(this.db, scope, run.id);
    return pinnedAt === null ? { ...run, pinned: false } : { ...run, pinned: true, pinnedAt };
  }
  list(input: RunList): RunPage {
    const { scope: owner, ...page } = input;
    const query = normalizeRunListQuery(page);
    const scope = normalizedScope(owner);
    runListPosition(scope, query);
    if (query.suiteId !== undefined) this.suites.getSuite({ scope, id: query.suiteId });
    const search = { scope, ...query };
    if (query.name !== undefined) {
      this.suites.workspace(scope);
      prepareHistorySearch(this.db, search);
    }
    return transaction(this.db, () => {
      this.suites.workspace(scope);
      const rows = historyKeys(this.db, search);
      const selected = rows.slice(0, query.limit);
      const last = selected.at(-1);
      const nextCursor =
        rows.length > query.limit && last
          ? encodeRunListCursor({ scope, query, requestedAt: last.requested_at, id: last.id })
          : null;
      const items = selected.map((row) => this.get({ scope, id: row.id }));
      const result = {
        scope,
        items,
        summaries: readHistorySummaries(this.db, scope, items),
        contexts: readRunListContexts(this.db, scope, items),
        nextCursor,
      };
      if (!runListPageMatches(result, scope, query)) throw new Error('Invalid persisted run page');
      return result;
    });
  }
}
