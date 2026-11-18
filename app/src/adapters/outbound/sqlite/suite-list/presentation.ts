import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import { runHistorySummaryMatches, validateApi } from '@beetle/contracts/api';
import type { Run, WorkspaceScope } from '@beetle/contracts/api';
import { readRunTimes } from '../run-annotations.js';
import { captureHistorySummary } from '../run-history/values.js';
import { StorageError } from '../protocol.js';

type Owned = Pick<Run, 'id' | 'scope' | 'activeAttemptId'>;
function duration(raw: SQLOutputValue | undefined, run: Owned): number | null {
  if (raw === null) return null;
  try {
    if (typeof raw !== 'string') throw new Error('Invalid stored summary');
    const summary = captureHistorySummary(JSON.parse(raw) as unknown);
    if (!runHistorySummaryMatches(summary, run)) throw new Error('Foreign stored summary');
    return summary.availability === 'ready' ? summary.testDurationMs : null;
  } catch {
    throw new StorageError('unavailable');
  }
}
/** Existing bounded durable-event and immutable-summary sources; no metric or file reads. */
export function latestRunPresentation(
  db: DatabaseSync,
  scope: WorkspaceScope,
  row: Record<string, SQLOutputValue>,
): { startedAt: string | null; testDurationMs: number | null } {
  if (
    typeof row.id !== 'string' ||
    typeof row.active_attempt_id !== 'string' ||
    !validateApi('Uuid', row.id).ok ||
    !validateApi('Uuid', row.active_attempt_id).ok
  ) {
    throw new StorageError('unavailable');
  }
  const run: Owned = { id: row.id, scope, activeAttemptId: row.active_attempt_id };
  return { startedAt: readRunTimes(db, run).startedAt, testDurationMs: duration(row.history_summary_json, run) };
}
