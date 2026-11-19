import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { compareRunListPosition, runListPosition, validateApi } from '@beetle/contracts/api';
import type { Run, RunHistoryCounts, RunListPosition } from '@beetle/contracts/api';
import type { RunList } from '../../../../ports/runs.js';
import { StorageError } from '../protocol.js';
import type { HistorySelection } from './selection.js';
import { inHistoryContext } from './selection.js';
import type { PrefixKey } from './rows.js';
interface Group {
  state: Run['state'];
  outcome: Run['outcome'];
  n: number;
  before: number;
}
const states = "'queued','dispatching','active','finalizing','finished','cancelled','errored'";
const outcomes = "'pending','passed','failed','inconclusive'";

/** Real aggregate statement, exported for query-plan verification. No blobs or configurations. */
export function historyCountsStatement(input: RunList, suiteId?: string) {
  const { scope, ...query } = input;
  const position = runListPosition(scope, query);
  const before = position ? `(requested_at,id)${query.order === 'oldest' ? '<=' : '>='}(?,?)` : '0';
  const values: SQLInputValue[] = position ? [position.requestedAt, position.id] : [];
  values.push(scope.organizationId, scope.workspaceId);
  if (suiteId !== undefined) values.push(suiteId);
  const index = suiteId === undefined ? 'runs_history_state_outcome' : 'runs_history_suite_state_outcome';
  return {
    sql: `SELECT CASE WHEN state IN (${states}) THEN state ELSE NULL END AS state,
      CASE WHEN outcome IN (${outcomes}) THEN outcome ELSE NULL END AS outcome,
      COUNT(*) AS n, COUNT(*) FILTER(WHERE ${before}) AS before,
      COUNT(*) FILTER(WHERE requested_at IS NOT strftime('%Y-%m-%dT%H:%M:%fZ',requested_at)) AS invalid
      FROM runs INDEXED BY ${index} WHERE organization_id=? AND workspace_id=?${suiteId === undefined ? '' : ' AND suite_id=?'}
      GROUP BY runs.state,runs.outcome LIMIT 29`,
    values,
  };
}
function groups(db: DatabaseSync, input: RunList, suiteId?: string): Group[] {
  const statement = historyCountsStatement(input, suiteId);
  const rows = db.prepare(statement.sql).all(...statement.values);
  if (rows.length > 28) throw new StorageError('unavailable');
  return rows.map(captureGroup);
}
function captureGroup(row: Record<string, unknown>): Group {
  const parsed = validateApi('RunListQuery', { limit: 1, state: row.state, outcome: row.outcome });
  if (!parsed.ok) throw new StorageError('unavailable');
  const { state, outcome } = parsed.value;
  if (state === undefined || outcome === undefined) throw new StorageError('unavailable');
  const n = safeCount(row.n),
    before = safeCount(row.before);
  if (row.invalid !== 0 || before > n || !validLifecycle(state, outcome)) throw new StorageError('unavailable');
  return { state, outcome, n, before };
}
function validLifecycle(state: Run['state'], outcome: Run['outcome']): boolean {
  const terminal = state === 'finished' || state === 'cancelled' || state === 'errored';
  if ((outcome === 'pending') === terminal) return false;
  return !terminal || state === 'finished' || outcome === 'inconclusive';
}
function safeCount(value: unknown): number {
  if (!count(value)) throw new StorageError('unavailable');
  return value;
}

function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function rowGroup(row: PrefixKey, position: RunListPosition | null): Group {
  const order = position ? compareRunListPosition({ id: row.id, requestedAt: row.requested_at }, position) : 0;
  const before = position !== null && (position.query.order === 'oldest' ? order <= 0 : order >= 0);
  return { state: row.state, outcome: row.outcome, n: 1, before: before ? 1 : 0 };
}
function contextGroups(db: DatabaseSync, input: RunList, selection: HistorySelection): Group[] {
  const { scope, ...query } = input;
  const position = runListPosition(scope, query);
  if (selection.prefix !== undefined)
    return selection.prefix
      .filter((row) => inHistoryContext(row, input, selection))
      .map((row) => rowGroup(row, position));
  if (selection.suites === null) return groups(db, input, input.suiteId);
  const selected = selection.suites.filter((id) => input.suiteId === undefined || input.suiteId === id);
  const result = selected.flatMap((id) => groups(db, input, id));
  for (const row of selection.notes)
    if (!selected.includes(row.suite_id) && inHistoryContext(row, input, selection))
      result.push(rowGroup(row, position));
  return result;
}
function matches(group: Group, input: RunList): boolean {
  return (
    (input.state === undefined || input.state === group.state) &&
    (input.outcome === undefined || input.outcome === group.outcome)
  );
}
function sum(rows: readonly Group[], predicate: (row: Group) => boolean, key: 'n' | 'before' = 'n'): number {
  const value = rows.reduce((total, row) => total + (predicate(row) ? row[key] : 0), 0);
  if (!count(value)) throw new StorageError('unavailable');
  return value;
}
/** Context counts ignore lifecycle/pin chips; matching/range counts apply every filter. */
export function historyCounts(db: DatabaseSync, input: RunList, selection: HistorySelection): RunHistoryCounts {
  const { scope, ...query } = input;
  const position = runListPosition(scope, query);
  const rows = contextGroups(db, input, { ...selection, notes: selection.countNotes ?? selection.notes });
  const pins = (selection.pinned ?? [])
    .filter((row) => inHistoryContext(row, input, selection))
    .map((row) => rowGroup(row, position));
  const matched = input.pinned === true ? pins : rows;
  return {
    all: sum(rows, () => true),
    running: sum(rows, (row) => row.state === 'active'),
    passed: sum(rows, (row) => row.outcome === 'passed'),
    failed: sum(rows, (row) => row.outcome === 'failed'),
    cancelled: sum(rows, (row) => row.state === 'cancelled'),
    pinned: pins.length,
    matched: sum(matched, (row) => matches(row, input)),
    before: sum(matched, (row) => matches(row, input), 'before'),
  };
}
