import type { DatabaseSync } from 'node:sqlite';
import { encodeJson } from '@beetle/contracts';
import type { AdmissionSnapshot, Candidate, PoolConfiguration, Reservation, RuntimeObservation, Scope } from '../admission/index.js';
import { Failure, owner } from './sql.js';

export function settings(db: DatabaseSync, now: number): AdmissionSnapshot {
  const row = db.prepare('SELECT * FROM admission_settings WHERE id=1').get();
  if (typeof row?.configuration_json !== 'string') throw new Failure('invalid_input');
  const reservations = db.prepare('SELECT reservation_json FROM reservations WHERE charged=1 ORDER BY id LIMIT 65').all();
  if (reservations.length > 64) throw new Failure('unavailable');
  const queue = db.prepare('SELECT id,candidate_json FROM admission_queue WHERE pending=1 ORDER BY id LIMIT 100').all();
  return { configuration: JSON.parse(row.configuration_json) as PoolConfiguration,
    observation: typeof row.observation_json === 'string' ? JSON.parse(row.observation_json) as RuntimeObservation : null,
    now, lastClock: Number(row.last_clock),
    reservations: reservations.map(item => JSON.parse(item.reservation_json as string) as Reservation),
    queue: queue.map(item => ({ ...JSON.parse(item.candidate_json as string) as Candidate, order: Number(item.id) })) };
}
export function candidate(db: DatabaseSync, key: Scope): Candidate {
  owner(db, key);
  const row = db.prepare('SELECT id,candidate_json,pending FROM admission_queue WHERE attempt_id=?').get(key.attemptId);
  if (!row) throw new Failure('not_found');
  if (row.pending !== 1) throw new Failure('conflict');
  return { ...JSON.parse(row.candidate_json as string) as Candidate, order: Number(row.id) };
}
export function findReservation(db: DatabaseSync, key: Scope): Reservation | null {
  owner(db, key);
  const row = db.prepare('SELECT reservation_json FROM reservations WHERE attempt_id=?').get(key.attemptId);
  return row ? JSON.parse(row.reservation_json as string) as Reservation : null;
}
export function reservation(db: DatabaseSync, key: Scope): Reservation {
  const value = findReservation(db, key);
  if (!value) throw new Failure('not_found');
  return value;
}
export function saveReservation(db: DatabaseSync, value: Reservation): Reservation {
  db.prepare('UPDATE reservations SET reservation_json=?,charged=? WHERE attempt_id=?')
    .run(encodeJson(value, 32_768), value.status === 'charged' ? 1 : 0, value.attemptId);
  return value;
}
