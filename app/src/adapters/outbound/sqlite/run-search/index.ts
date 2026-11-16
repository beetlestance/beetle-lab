import type { DatabaseSync } from 'node:sqlite';
import { compareRunListPosition, normalizeRunListQuery, runListPosition } from '@beetle/contracts/api';
import type { RunList } from '../../../../ports/runs.js';
import { StorageError } from '../protocol.js';
import { runListStatement } from '../run-list-query.js';
import { prepareNameSearch } from './backfill.js';
import { matchingSuites, workspaceNameMatches } from './names.js';
export interface HistoryKey { id: string; requested_at: string }
export function prepareHistorySearch(db: DatabaseSync, input: RunList): void {
  if (input.name !== undefined && !workspaceNameMatches(db, input.scope, input.name)) prepareNameSearch(db, input.scope);
}
/** Scalar selection only; caller owns one read transaction and bounded Run projection. */
export function historyKeys(db: DatabaseSync, input: RunList): HistoryKey[] {
  if (input.runIdPrefix !== undefined) return prefixKeys(db, input);
  if (input.name === undefined || workspaceNameMatches(db, input.scope, input.name)) return suiteKeys(db, input);
  const query = normalizeRunListQuery(inputPage(input));
  let result: HistoryKey[] = [];
  for (const id of matchingSuites(db, input.scope, input.name)) {
    if(query.suiteId!==undefined&&id.toLowerCase()!==query.suiteId)continue;
    result = [...result, ...suiteKeys(db, input, id)].sort((a, b) => orderKeys(a, b, query.order)).slice(0, query.limit + 1);
  }
  return result;
}
function inputPage(input: RunList) {
  const page = { ...input } as Partial<RunList>; delete page.scope;
  return page as Omit<RunList, 'scope'>;
}
function orderKeys(a: HistoryKey, b: HistoryKey, order: 'newest' | 'oldest'): number {
  const comparison = compareRunListPosition({ id: a.id, requestedAt: a.requested_at }, { id: b.id, requestedAt: b.requested_at });
  return order === 'newest' ? -comparison : comparison;
}
function suiteKeys(db: DatabaseSync, input: RunList, suiteId?: string): HistoryKey[] {
  const statement = runListStatement(input, suiteId);
  return db.prepare(statement.sql).all(...statement.values) as unknown as HistoryKey[];
}
interface PrefixKey extends HistoryKey { state: string; outcome: string; suite_id:string }
/** Prefix bound applies before lifecycle/cursor filtering; pagination cannot hide overflow. */
function prefixKeys(db: DatabaseSync, input: RunList): HistoryKey[] {
  const query = normalizeRunListQuery(inputPage(input));
  const prefix = query.runIdPrefix!;
  const rows = db.prepare(`SELECT id,requested_at,state,outcome,suite_id FROM runs INDEXED BY runs_page
    WHERE organization_id=? AND workspace_id=? AND id>=? AND id<? ORDER BY id LIMIT 257`)
    .all(input.scope.organizationId, input.scope.workspaceId, prefix, prefix + '~') as unknown as PrefixKey[];
  if (rows.length > 256) throw new StorageError('search_too_broad');
  const position = runListPosition(input.scope, query);
  return rows.filter(row => accepts(row, query, position))
    .sort((a, b) => orderKeys(a, b, query.order)).slice(0, query.limit + 1);
}
function accepts(row: PrefixKey, query: ReturnType<typeof normalizeRunListQuery>, position: ReturnType<typeof runListPosition>): boolean {
  if(query.suiteId!==undefined&&row.suite_id.toLowerCase()!==query.suiteId)return false;
  if (query.state !== undefined && row.state !== query.state) return false;
  if (query.outcome !== undefined && row.outcome !== query.outcome) return false;
  if (position === null) return true;
  const comparison = compareRunListPosition({ requestedAt: row.requested_at, id: row.id }, position);
  return query.order === 'newest' ? comparison < 0 : comparison > 0;
}
