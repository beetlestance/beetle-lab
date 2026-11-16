import type { DatabaseSync } from 'node:sqlite';
import { runHistorySummaryMatches } from '@beetle/contracts/api';
import { StorageError } from '../protocol.js';
import { boundedCopy } from '../input-values.js';
import type { RunHistorySummary } from '@beetle/contracts/api';

export function captureHistorySummary(value: unknown): RunHistorySummary {
  const copy = boundedCopy(value, 2048) as RunHistorySummary;
  if (!runHistorySummaryMatches(copy, { id: copy.runId, activeAttemptId: copy.attemptId })) throw new StorageError('invalid_input');
  return copy;
}
/** Registers only bounded pure row validation, before migration/trigger execution. */
export function registerHistoryValidation(db: DatabaseSync): void {
  db.function('valid_history_summary', { deterministic: true }, (text, id, attempt) => {
    if (typeof text !== 'string' || Buffer.byteLength(text) > 2048 || typeof id !== 'string' || typeof attempt !== 'string') return 0;
    try { return Number(runHistorySummaryMatches(JSON.parse(text) as RunHistorySummary, { id, activeAttemptId: attempt })); }
    catch { return 0; }
  });
}
