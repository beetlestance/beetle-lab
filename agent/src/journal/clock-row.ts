import type { SupervisionState } from './protocol.js';
import { sqlTextColumn, sqlIntegerColumn } from './sql-columns.js';
import { storedRecord, storedInteger, storedFlag } from './row-values.js';
import { Failure } from './failure.js';
export interface ClockRow {
  high_water: number;
  fenced: 0 | 1;
  cancel_at: number | null;
  cancel_reason: SupervisionState['cancelReason'];
  stop_immediate: 0 | 1;
}
export const clockColumns = [
  sqlIntegerColumn('high_water'),
  sqlIntegerColumn('fenced'),
  sqlIntegerColumn('cancel_at', true),
  sqlTextColumn('cancel_reason', 64, true),
  sqlIntegerColumn('stop_immediate'),
].join(',');
function reason(input: unknown): SupervisionState['cancelReason'] {
  switch (input) {
    case null:
    case 'cancelled':
    case 'timeout':
    case 'output_limit':
    case 'artifact_incomplete':
    case 'clock_integrity':
      return input;
    default:
      throw new Failure('unavailable');
  }
}
export function captureClockRow(input: unknown): ClockRow | undefined {
  if (input === undefined) return undefined;
  const row = storedRecord(input);
  const high = storedInteger(row.high_water);
  return {
    high_water: high,
    fenced: storedFlag(row.fenced),
    cancel_at: row.cancel_at === null ? null : storedInteger(row.cancel_at, 0, high),
    cancel_reason: reason(row.cancel_reason),
    stop_immediate: storedFlag(row.stop_immediate),
  };
}
