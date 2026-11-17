import { sqlTextColumn, sqlIntegerColumn } from './sql-columns.js';
import { validateApi } from '@beetle/contracts/api';
import type { Run } from '@beetle/contracts/api';
import type { RunKey } from '../../../ports/runs.js';
import type { RunAnnotations } from './run-annotations.js';
import { StorageError } from './protocol.js';
const textColumns: [string, number, boolean][] = [
  ['snapshot_json', 65536, false],
  ['state', 64, false],
  ['outcome', 64, false],
  ['validation_status', 64, false],
  ['active_attempt_id', 45, false],
  ['reason', 64, true],
];
export const runColumns = [
  ...textColumns.map(([name, maximum, nullable]) => sqlTextColumn(name, maximum, nullable)),
  sqlIntegerColumn('version'),
  sqlIntegerColumn('cancellation_requested'),
].join(',');
function initialRun(input: unknown): Run {
  if (typeof input !== 'string' || Buffer.byteLength(input) > 65536) throw new StorageError('unavailable');
  let value: unknown;
  try {
    value = JSON.parse(input) as unknown;
  } catch {
    throw new StorageError('unavailable');
  }
  const parsed = validateApi('Run', value);
  if (!parsed.ok) throw new StorageError('unavailable');
  return parsed.value;
}
/** Annotations (note, runtime times) come from separate durable rows, never the snapshot. */
export function captureRunRow(input: unknown, key: RunKey, annotations?: RunAnnotations): Run {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new StorageError('unavailable');
  const row = input as Record<string, unknown>;
  const initial = initialRun(row.snapshot_json);
  if (row.cancellation_requested !== 0 && row.cancellation_requested !== 1) throw new StorageError('unavailable');
  const parsed = validateApi('Run', {
    ...initial,
    version: row.version,
    state: row.state,
    outcome: row.outcome,
    validationStatus: row.validation_status,
    activeAttemptId: row.active_attempt_id,
    cancellationRequested: row.cancellation_requested === 1,
    reason: row.reason,
    ...annotations,
  });
  if (!parsed.ok) throw new StorageError('unavailable');
  const run = parsed.value;
  if (
    run.id !== key.id.toLowerCase() ||
    run.scope.organizationId !== key.scope.organizationId.toLowerCase() ||
    run.scope.workspaceId !== key.scope.workspaceId.toLowerCase()
  )
    throw new StorageError('unavailable');
  return run;
}
