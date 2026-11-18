import { sqlIntegerColumn } from './sql-columns.js';
import { captureRevisionSummary, revisionSummaryColumns } from './suite-row.js';
import { StorageError } from './protocol.js';
import type { DatabaseSync } from 'node:sqlite';
import { normalizedScope } from './suites.js';
import type { SuiteList, RevisionList } from '../../../ports/suites.js';
import { lower } from './input.js';
import { encodeRevisionListCursor, revisionListPosition } from '@beetle/contracts/api';
import type { Suites } from './suites.js';
import { SuiteListReads } from './suite-list/index.js';

/** Exact prepared statements also used by query-plan tests. */
const revisionPageProjection = `SELECT ${revisionSummaryColumns},
 (SELECT substr(p.id,1,46) FROM suite_revisions p WHERE p.organization_id=suite_revisions.organization_id
 AND p.workspace_id=suite_revisions.workspace_id AND p.suite_id=suite_revisions.suite_id
 AND p.ordinal<suite_revisions.ordinal ORDER BY p.ordinal DESC LIMIT 1) AS previous_revision_id
 FROM suite_revisions WHERE organization_id=? AND workspace_id=? AND suite_id=?`;
export const firstRevisionPageSql = `${revisionPageProjection} ORDER BY suite_revisions.ordinal DESC LIMIT ?`;
export const revisionPageSql = `${revisionPageProjection} AND ordinal<=? ORDER BY suite_revisions.ordinal DESC LIMIT ?`;
function positionOf(query: RevisionList) {
  const { scope, suiteId, ...page } = query;
  try {
    return revisionListPosition(scope, suiteId, page);
  } catch {
    throw new StorageError('invalid_input');
  }
}
function before(db: DatabaseSync, query: RevisionList): number | null {
  const position = positionOf(query);
  if (!position) return null;
  const { scope, suiteId } = query;
  const row = db
    .prepare(
      `SELECT ${sqlIntegerColumn('ordinal')} FROM suite_revisions
    WHERE organization_id=? AND workspace_id=? AND suite_id=? AND id=?`,
    )
    .get(lower(scope.organizationId), lower(scope.workspaceId), lower(suiteId), position.id);
  if (row !== undefined && row.ordinal === null) throw new StorageError('unavailable');
  if (row?.ordinal !== position.ordinal) throw new StorageError('invalid_input');
  return position.ordinal - 1;
}
export class SuiteReads {
  private readonly listing: SuiteListReads;
  constructor(
    private readonly db: DatabaseSync,
    private readonly suites: Suites,
  ) {
    this.listing = new SuiteListReads(db, suites);
  }
  list(query: SuiteList | RevisionList) {
    if (!('suiteId' in query)) return this.listing.list(query);
    this.suites.workspace(query.scope);
    this.suites.getSuite({ scope: query.scope, id: query.suiteId });
    const bound = before(this.db, query);
    const values = [lower(query.scope.organizationId), lower(query.scope.workspaceId), lower(query.suiteId)];
    const rows = this.db
      .prepare(bound === null ? firstRevisionPageSql : revisionPageSql)
      .all(...values, ...(bound === null ? [] : [bound]), query.limit + 1)
      .map((row) => captureRevisionSummary(row, query.scope, query.suiteId));
    const items = rows.slice(0, query.limit);
    const last = items.at(-1);
    const nextCursor =
      rows.length > query.limit && last
        ? encodeRevisionListCursor({
            scope: query.scope,
            suiteId: query.suiteId,
            limit: query.limit,
            ordinal: last.ordinal,
            id: last.id,
          })
        : null;
    return { scope: normalizedScope(query.scope), suiteId: lower(query.suiteId), items, nextCursor };
  }
}
