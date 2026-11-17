import { captureHistorySummaryRow } from './rows.js';
import type { SummaryRow as Row } from './rows.js';
import { sqlTextColumn, sqlIntegerColumn } from '../sql-columns.js';
import type { DatabaseSync } from 'node:sqlite';
import { pendingRunHistorySummary, runHistorySummaryMatches } from '@beetle/contracts/api';
import type { Run, RunHistorySummary, WorkspaceScope } from '@beetle/contracts/api';
import { StorageError } from '../protocol.js';
import { captureHistorySummary } from './values.js';

/** One bounded scalar join under the caller's existing history transaction. */
export function readHistorySummaries(
  db: DatabaseSync,
  scope: WorkspaceScope,
  runs: readonly Run[],
): RunHistorySummary[] {
  if (!runs.length) return [];
  if (runs.length > 100) throw new StorageError('invalid_input');
  const placeholders = runs.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT ${sqlTextColumn('id', 45, false, 'r.')},${sqlTextColumn('active_attempt_id', 45, false, 'r.')},${sqlTextColumn('history_summary_json', 2048, true, 'r.')},
    ${sqlIntegerColumn('charged_bytes', true, 'a.')},${sqlIntegerColumn('metadata_bytes', true, 'a.')},${sqlIntegerColumn('reserved_bytes', true, 'cc.', 'cleanup_bytes')},
    ${sqlIntegerColumn('refunded_bytes', true, 'f.', 'source_refund')},${sqlIntegerColumn('refunded_bytes', true, 'z.', 'absence_refund')}
    FROM runs r LEFT JOIN attempt_output_allocations a ON a.attempt_id=r.active_attempt_id
    LEFT JOIN backend_cleanup_controls cc ON cc.attempt_id=r.active_attempt_id
    LEFT JOIN execution_output_finalizations f ON f.attempt_id=r.active_attempt_id
    LEFT JOIN execution_output_absence_finalizations z ON z.attempt_id=r.active_attempt_id
    WHERE r.organization_id=? AND r.workspace_id=? AND r.id IN (${placeholders})`,
    )
    .all(scope.organizationId, scope.workspaceId, ...runs.map((run) => run.id))
    .map(captureHistorySummaryRow);
  const indexed = new Map(rows.map((row) => [row.id, row]));
  return runs.map((run) => {
    const row = indexed.get(run.id);
    if (!row || row.active_attempt_id !== run.activeAttemptId) throw new StorageError('unavailable');
    const summary = stored(row, run);
    const value = {
      ...summary,
      retainedLogicalBytes: retained(row),
      metadataAllowanceBytes: (row.metadata_bytes ?? 0) + (row.cleanup_bytes ?? 0),
    };
    if (!runHistorySummaryMatches(value, run)) throw new StorageError('unavailable');
    return value;
  });
}
function retained(row: Row): number {
  if (row.source_refund !== null && row.absence_refund !== null) throw new StorageError('unavailable');
  const value = (row.charged_bytes ?? 0) - (row.source_refund ?? row.absence_refund ?? 0) + (row.cleanup_bytes ?? 0);
  if (!Number.isSafeInteger(value) || value < 0) throw new StorageError('unavailable');
  return value;
}

function stored(row: Row, run: Run): RunHistorySummary {
  if ((row.charged_bytes === null) !== (row.metadata_bytes === null)) throw new StorageError('unavailable');
  try {
    return row.history_summary_json === null
      ? pendingRunHistorySummary(run)
      : captureHistorySummary(JSON.parse(row.history_summary_json) as unknown);
  } catch {
    throw new StorageError('unavailable');
  }
}
