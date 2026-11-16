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
interface ClockRow { high_water: number; fenced: number; cancel_at: number | null; cancel_reason: SupervisionState['cancelReason']; stop_immediate: number }

function cancellationTime(prior: ClockRow | undefined, wasCancelled: boolean,
  input: SupervisionCommand, high: number): number | null {
  if (prior?.cancel_at != null) return prior.cancel_at;
  return input.cancel && !wasCancelled ? high : null;
}
function cancellationReason(prior: ClockRow | undefined, wasCancelled: boolean,
  input: SupervisionCommand): SupervisionState['cancelReason'] {
  if (wasCancelled) return prior?.cancel_reason ?? null;
  return input.cancel ? input.reason ?? 'cancelled' : null;
}
function unanchored(prior: ClockRow | undefined, wasCancelled: boolean): boolean {
  return wasCancelled && (prior?.cancel_at == null || prior.cancel_reason == null);
}
function clockFenced(prior: ClockRow | undefined, wasCancelled: boolean, input: SupervisionCommand, high: number): boolean {
  return prior?.fenced === 1 || input.now < high || input.reason === 'clock_integrity' || unanchored(prior, wasCancelled);
}
function immediate(prior: ClockRow | undefined, input: SupervisionCommand): boolean {
  return prior?.stop_immediate === 1 || input.reason === 'output_limit'
    || input.reason === 'artifact_incomplete' || input.reason === 'clock_integrity';
}

function clockState(prior: ClockRow | undefined, global: number, wasCancelled: boolean,
  input: SupervisionCommand): SupervisionState {
  const previousHigh = Math.max(prior?.high_water ?? 0, global);
  const high = Math.max(previousHigh, input.now);
  // A pre-v4 cancel has no trustworthy origin. Preserve unknown rather than
  // granting a fresh grace period or inventing an elapsed timestamp.
  return { clockHighWater: high,
    clockFenced: clockFenced(prior, wasCancelled, input, previousHigh),
    cancelRequestedAt: cancellationTime(prior, wasCancelled, input, high),
    cancelRequested: wasCancelled || input.cancel === true,
    cancelReason: cancellationReason(prior, wasCancelled, input), immediateStop: immediate(prior, input) };
}

/** Strict input independently checked on both sides of the worker boundary. */
export function checkedWallTime(now: number): void {
  if (!Number.isSafeInteger(now) || now < 0 || now > 8_640_000_000_000_000) throw new Failure('invalid_input');
}
export function checkedSupervision(input: SupervisionCommand): void {
  checkedWallTime(input.now);
  if (input.cancel !== undefined && input.cancel !== true) throw new Failure('invalid_input');
  if (input.reason !== undefined && (input.cancel !== true
    || !['cancelled', 'timeout', 'output_limit', 'artifact_incomplete', 'clock_integrity'].includes(input.reason))) throw new Failure('invalid_input');
}

function cancel(db: DatabaseSync, id: number, attemptId: string): void {
  db.prepare('UPDATE accepted_attempts SET cancel_requested=1 WHERE id=?').run(id);
  db.prepare('UPDATE admission_queue SET pending=0,decision_json=? WHERE attempt_id=? AND pending=1')
    .run('{"kind":"reject","reason":"cancelled"}', attemptId);
}

/** No generation can acquire a new clock; owner() checks it before any write. */
export function supervise(db: DatabaseSync, input: SupervisionCommand): SupervisionState {
  return transaction(db, () => superviseAtomic(db, input));
}

/** Caller owns the immediate transaction, including any original receipt write. */
export function superviseAtomic(db: DatabaseSync, input: SupervisionCommand): SupervisionState {
  checkedSupervision(input);
  const row = owner(db, input.key);
  const prior = db.prepare('SELECT high_water,fenced,cancel_at,cancel_reason,stop_immediate FROM supervision_clock WHERE attempt_id=?')
    .get(row.attempt_id) as unknown as ClockRow | undefined;
  const global = db.prepare('SELECT last_clock FROM admission_settings WHERE id=1').get()?.last_clock;
  if (typeof global !== 'number' || !Number.isSafeInteger(global)) throw new Failure('unavailable');
  const state = clockState(prior, global, row.cancel_requested === 1, input);
  if (input.cancel) cancel(db, row.id, row.attempt_id);
  db.prepare(`INSERT INTO supervision_clock(attempt_id,high_water,fenced,cancel_at,cancel_reason,stop_immediate) VALUES (?,?,?,?,?,?)
    ON CONFLICT(attempt_id) DO UPDATE SET high_water=excluded.high_water,
    fenced=excluded.fenced,cancel_at=excluded.cancel_at,cancel_reason=excluded.cancel_reason,
    stop_immediate=excluded.stop_immediate`).run(row.attempt_id,
    state.clockHighWater, Number(state.clockFenced), state.cancelRequestedAt, state.cancelReason, Number(state.immediateStop));
  return state;
}
