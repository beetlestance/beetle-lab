import { captureHistoryKey } from './rows.js';
import type { HistoryKey, PrefixKey } from './rows.js';
export type { HistoryKey } from './rows.js';
import type { DatabaseSync } from 'node:sqlite';
import { compareRunListPosition, normalizeRunListQuery, runListPosition } from '@beetle/contracts/api';
import type { RunList } from '../../../../ports/runs.js';
import { runListStatement } from '../run-list-query.js';
import { prepareNameSearch } from './backfill.js';
import { workspaceNameMatches } from './names.js';
import { historySelection, inHistoryContext } from './selection.js';
export function prepareHistorySearch(db: DatabaseSync, input: RunList): void {
  if (input.name !== undefined && !workspaceNameMatches(db, input.scope, input.name))
    prepareNameSearch(db, input.scope);
}
/** Scalar selection only; caller owns one read transaction and bounded Run projection. */
export function historyKeys(db: DatabaseSync, input: RunList, selection = historySelection(db, input)): HistoryKey[] {
  const query = normalizeRunListQuery(inputPage(input));
  const position = runListPosition(input.scope, query);
  const rows = input.pinned === true ? selection.pinned : selection.prefix;
  if (rows !== undefined)
    return top(
      rows.filter((row) => inHistoryContext(row, input, selection) && accepts(row, query, position)),
      query,
    );
  if (selection.suites === null) return suiteKeys(db, input);
  let result = top(
    selection.notes.filter((row) => accepts(row, query, position)),
    query,
  );
  for (const id of selection.suites) {
    if (query.suiteId !== undefined && id !== query.suiteId) continue;
    result = top([...result, ...suiteKeys(db, input, id)], query);
  }
  return result;
}
/** A run matching both its suite path and its note appears once. */
function top(keys: readonly HistoryKey[], query: ReturnType<typeof normalizeRunListQuery>): HistoryKey[] {
  const unique = new Map(keys.map((key) => [key.id, { id: key.id, requested_at: key.requested_at }]));
  return [...unique.values()].sort((a, b) => orderKeys(a, b, query.order)).slice(0, query.limit + 1);
}
function inputPage(input: RunList) {
  const page = { ...input } as Partial<RunList>;
  delete page.scope;
  return page as Omit<RunList, 'scope'>;
}
function orderKeys(a: HistoryKey, b: HistoryKey, order: 'newest' | 'oldest'): number {
  const comparison = compareRunListPosition(
    { id: a.id, requestedAt: a.requested_at },
    { id: b.id, requestedAt: b.requested_at },
  );
  return order === 'newest' ? -comparison : comparison;
}
function suiteKeys(db: DatabaseSync, input: RunList, suiteId?: string): HistoryKey[] {
  const statement = runListStatement(input, suiteId);
  return db
    .prepare(statement.sql)
    .all(...statement.values)
    .map(captureHistoryKey);
}
function accepts(
  row: PrefixKey,
  query: ReturnType<typeof normalizeRunListQuery>,
  position: ReturnType<typeof runListPosition>,
): boolean {
  if (query.suiteId !== undefined && row.suite_id.toLowerCase() !== query.suiteId) return false;
  if (query.state !== undefined && row.state !== query.state) return false;
  if (query.outcome !== undefined && row.outcome !== query.outcome) return false;
  if (position === null) return true;
  const comparison = compareRunListPosition({ requestedAt: row.requested_at, id: row.id }, position);
  return query.order === 'newest' ? comparison < 0 : comparison > 0;
}
export { prepareNameSearch } from './backfill.js';
export { matchingSuiteNames } from './names.js';
