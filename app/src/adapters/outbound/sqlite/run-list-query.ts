import type { SQLInputValue } from 'node:sqlite';
import { normalizeRunListQuery, runListPosition } from '@beetle/contracts/api';
import type { RunList } from '../../../ports/runs.js';
import { normalizedScope } from './suites.js';

/** Closed SQL structure; all caller values stay bound parameters. */
export function runListStatement(input: RunList, suiteId?: string): { sql: string; values: SQLInputValue[] } {
  const { scope: owner, ...page } = input;
  const scope = normalizedScope(owner);
  const query = normalizeRunListQuery(page);
  const position = runListPosition(scope, query);
  const predicates = ['organization_id=?', 'workspace_id=?'];
  const values: SQLInputValue[] = [scope.organizationId, scope.workspaceId];
  suiteId=suiteId??query.suiteId;
  if (suiteId !== undefined) { predicates.push('suite_id=?'); values.push(suiteId); }
  if (query.state !== undefined) { predicates.push('state=?'); values.push(query.state); }
  if (query.outcome !== undefined) { predicates.push('outcome=?'); values.push(query.outcome); }
  const direction = query.order === 'newest' ? 'DESC' : 'ASC';
  if (position) {
    predicates.push(query.order === 'newest' ? '(requested_at,id)<(?,?)' : '(requested_at,id)>(?,?)');
    values.push(position.requestedAt, position.id);
  }
  const base = historyIndex(query.state !== undefined, query.outcome !== undefined);
  const index = suiteId === undefined ? base : suiteHistoryIndex(query.state !== undefined, query.outcome !== undefined);
  values.push(query.limit + 1);
  return { sql: `SELECT id,requested_at FROM runs INDEXED BY ${index} WHERE ${predicates.join(' AND ')} ORDER BY requested_at ${direction},id ${direction} LIMIT ?`, values };
}

function historyIndex(state: boolean, outcome: boolean): string {
  if (state && outcome) return 'runs_history_state_outcome';
  if (outcome) return 'runs_history_outcome';
  return state ? 'runs_overview_active' : 'runs_overview_recent';
}

function suiteHistoryIndex(state: boolean, outcome: boolean): string {
  if (state && outcome) return 'runs_history_suite_state_outcome';
  if (outcome) return 'runs_history_suite_outcome';
  return state ? 'runs_history_suite_state' : 'runs_history_suite';
}
