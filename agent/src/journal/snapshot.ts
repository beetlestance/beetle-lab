import type { DatabaseSync } from 'node:sqlite';
import type { AttemptSnapshot } from '@beetle/contracts';
import { captureClockRow, clockColumns } from './clock-row.js';
import { admissionSnapshot } from './admission-snapshot.js';
import { outputDeliveryClosed } from './output-delivery-closed.js';
import { snapshot as sequenceSnapshot } from './sql.js';
import type { Row } from './sql.js';

export function snapshot(db: DatabaseSync, row: Row): AttemptSnapshot {
  const admission = admissionSnapshot(db, row);
  const sequence = sequenceSnapshot(row);
  const systemStopReason =
    admission?.state === 'released' && outputDeliveryClosed(db, row.attempt_id)
      ? sequence.cancelRequested
        ? readSystemStop(db, row.attempt_id)
        : null
      : undefined;
  return {
    ...sequence,
    ...(admission === undefined ? {} : { admission }),
    ...(systemStopReason === undefined ? {} : { systemStopReason }),
  };
}

function readSystemStop(db: DatabaseSync, attemptId: string): AttemptSnapshot['systemStopReason'] {
  const clock = captureClockRow(
    db.prepare(`SELECT ${clockColumns} FROM supervision_clock WHERE attempt_id=?`).get(attemptId),
  );
  if (!clock || clock.cancel_at === null || !clock.cancel_reason || clock.cancel_reason === 'cancelled') return null;
  return clock.cancel_reason;
}
