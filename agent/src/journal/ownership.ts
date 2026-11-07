import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { AdmissionCommand, AdmissionValue, ReleaseEvidence, Reservation } from '../admission/index.js';
import { reservation, saveReservation } from './admission-data.js';
import { canonical } from './input.js';
import { Failure } from './sql.js';

type OwnershipCommand = Exclude<AdmissionCommand, { kind: 'configure' | 'observe' | 'offer' | 'admit' | 'reservations' }>;
function active(value: Reservation): void {
  if (value.status !== 'charged' || value.aborted) throw new Failure('conflict');
}
function binding(value: Reservation, input: { createToken: string; specDigest: string; runtimeId: string }): void {
  if (value.createToken !== input.createToken || value.specDigest !== input.specDigest) throw new Failure('conflict');
  if (value.runtimeId !== null && value.runtimeId !== input.runtimeId) throw new Failure('conflict');
}
function createClaim(db: DatabaseSync, value: Reservation, specDigest: string): AdmissionValue {
  if (value.specDigest !== null && value.specDigest !== specDigest) throw new Failure('conflict');
  if (value.createToken) return { reservation: value, token: value.createToken, dispatchAllowed: false };
  active(value);
  const token = randomUUID();
  const updated = saveReservation(db, { ...value, createToken: token, specDigest });
  return { reservation: updated, token, dispatchAllowed: true };
}
function bind(db: DatabaseSync, value: Reservation, input: Extract<AdmissionCommand, { kind: 'bindRuntime' }>): AdmissionValue {
  active(value); binding(value, input);
  return saveReservation(db, { ...value, runtimeId: input.runtimeId });
}
function startClaim(db: DatabaseSync, value: Reservation, input: Extract<AdmissionCommand, { kind: 'claimStart' }>): AdmissionValue {
  binding(value, input);
  if (value.runtimeId !== input.runtimeId) throw new Failure('conflict');
  if (value.startToken) return { reservation: value, token: value.startToken, dispatchAllowed: false };
  active(value);
  const token = randomUUID();
  return { reservation: saveReservation(db, { ...value, startToken: token }), token, dispatchAllowed: true };
}
function release(db: DatabaseSync, evidence: ReleaseEvidence): Reservation {
  const value = reservation(db, evidence.key);
  binding(value, evidence);
  if (value.runtimeId !== evidence.runtimeId) throw new Failure('conflict');
  if (evidence.runtime.observedAt < value.admittedAt || evidence.collection.observedAt < value.admittedAt) {
    throw new Failure('invalid_input');
  }
  if (value.releaseEvidence) {
    if (canonical(value.releaseEvidence) !== canonical(evidence)) throw new Failure('conflict');
    return value;
  }
  active(value);
  return saveReservation(db, { ...value, status: 'released', releaseEvidence: evidence });
}
export function ownershipCommand(db: DatabaseSync, input: OwnershipCommand): AdmissionValue {
  if (input.kind === 'release') return release(db, input.evidence);
  const value = reservation(db, input.key);
  switch (input.kind) {
    case 'reservation': return value;
    case 'claimCreate': return createClaim(db, value, input.specDigest);
    case 'bindRuntime': return bind(db, value, input);
    case 'claimStart': return startClaim(db, value, input);
    case 'abortUnstarted':
      if (value.createToken !== null || value.startToken !== null || value.runtimeId !== null) throw new Failure('conflict');
      return saveReservation(db, { ...value, status: 'released', aborted: true });
  }
}
