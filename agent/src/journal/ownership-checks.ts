import type { DatabaseSync } from 'node:sqlite';
import type { Reservation } from '../admission/index.js';
import { Failure, owner } from './sql.js';

export function active(value: Reservation): void {
  if (value.status !== 'charged' || value.aborted) throw new Failure('conflict');
}
export function firstAuthorization(db: DatabaseSync, value: Reservation): void {
  active(value);
  if (owner(db, value).cancel_requested) throw new Failure('conflict');
}
export function binding(value: Reservation, input: { createToken: string; specDigest: string; runtimeId: string }): void {
  if (value.createToken !== input.createToken || value.specDigest !== input.specDigest) throw new Failure('conflict');
  if (value.runtimeId !== null && value.runtimeId !== input.runtimeId) throw new Failure('conflict');
}
