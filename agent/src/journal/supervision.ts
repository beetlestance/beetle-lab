import type { DatabaseSync } from 'node:sqlite';
import type { SupervisionCommand, SupervisionState } from './protocol.js';
import { Failure, owner, transaction } from './sql.js';

export const migration004 = `
  CREATE TABLE supervision_clock (
    attempt_id TEXT PRIMARY KEY REFERENCES accepted_attempts(attempt_id),
    high_water INTEGER NOT NULL CHECK(high_water BETWEEN 0 AND 9007199254740991),
    fenced INTEGER NOT NULL CHECK(fenced IN (0,1)),
    cancel_at INTEGER CHECK(cancel_at BETWEEN 0 AND high_water)
  );
  PRAGMA user_version=4;
`;
interface ClockRow { high_water: number; fenced: number; cancel_at: number | null }

function cancellationTime(prior: ClockRow | undefined, wasCancelled: boolean,
  input: SupervisionCommand, high: number): number | null {
  if (prior?.cancel_at != null) return prior.cancel_at;
  return input.cancel && !wasCancelled ? high : null;
}

function clockState(prior: ClockRow | undefined, global: number, wasCancelled: boolean,
  input: SupervisionCommand): SupervisionState {
  const previousHigh = Math.max(prior?.high_water ?? 0, global);
  const high = Math.max(previousHigh, input.now);
  // A pre-v4 cancel has no trustworthy origin. Preserve unknown rather than
  // granting a fresh grace period or inventing an elapsed timestamp.
  const unanchored = wasCancelled && prior?.cancel_at == null;
  return { clockHighWater: high,
    clockFenced: prior?.fenced === 1 || input.now < previousHigh || unanchored,
    cancelRequestedAt: cancellationTime(prior, wasCancelled, input, high),
    cancelRequested: wasCancelled || input.cancel === true };
}

/** Strict input independently checked on both sides of the worker boundary. */
export function checkedSupervision(input: SupervisionCommand): void {
  if (!Number.isSafeInteger(input.now) || input.now < 0 || input.now > 8_640_000_000_000_000
    || input.cancel !== undefined && input.cancel !== true) throw new Failure('invalid_input');
}

function cancel(db: DatabaseSync, id: number, attemptId: string): void {
  db.prepare('UPDATE accepted_attempts SET cancel_requested=1 WHERE id=?').run(id);
  db.prepare('UPDATE admission_queue SET pending=0,decision_json=? WHERE attempt_id=? AND pending=1')
    .run('{"kind":"reject","reason":"cancelled"}', attemptId);
}

/** No generation can acquire a new clock; owner() checks it before any write. */
export function supervise(db: DatabaseSync, input: SupervisionCommand): SupervisionState {
  checkedSupervision(input);
  return transaction(db, () => {
    const row = owner(db, input.key);
    const prior = db.prepare('SELECT high_water,fenced,cancel_at FROM supervision_clock WHERE attempt_id=?')
      .get(row.attempt_id) as unknown as ClockRow | undefined;
    const global = db.prepare('SELECT last_clock FROM admission_settings WHERE id=1').get()?.last_clock;
    if (typeof global !== 'number' || !Number.isSafeInteger(global)) throw new Failure('unavailable');
    const state = clockState(prior, global, row.cancel_requested === 1, input);
    if (input.cancel) cancel(db, row.id, row.attempt_id);
    db.prepare(`INSERT INTO supervision_clock(attempt_id,high_water,fenced,cancel_at) VALUES (?,?,?,?)
      ON CONFLICT(attempt_id) DO UPDATE SET high_water=excluded.high_water,
      fenced=excluded.fenced,cancel_at=excluded.cancel_at`).run(row.attempt_id,
      state.clockHighWater, Number(state.clockFenced), state.cancelRequestedAt);
    return state;
  });
}
