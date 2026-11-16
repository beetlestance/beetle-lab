import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { AdmissionCommand, AdmissionValue, Reservation, ReleaseEvidence } from '../admission/index.js';
import { reservation, saveReservation } from './admission-data.js';
import { active, binding, firstAuthorization } from './ownership-checks.js';
import { releaseSettled, settleLaunch } from './launch-settlement.js';
import { Failure } from './sql.js';

type OwnershipCommand = Exclude<AdmissionCommand, { kind: 'configure' | 'observe' | 'offer' | 'admit' | 'reservations' }>;
function createClaim(db: DatabaseSync, value: Reservation, specDigest: string): AdmissionValue {
  if (value.specDigest !== null && value.specDigest !== specDigest) throw new Failure('conflict');
  if (value.createToken) return { reservation: value, token: value.createToken, dispatchAllowed: false };
  firstAuthorization(db, value);
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
  firstAuthorization(db, value);
  if (value.launchClosed) throw new Failure('conflict');
  if (input.now < value.admittedAt) throw new Failure('invalid_input');
  const token = randomUUID();
  return { reservation: saveReservation(db, { ...value, startToken: token, startClaimedAt: input.now, launchEpoch: 1 }), token, dispatchAllowed: true };
}
export function requireUnstarted(value: Reservation): void {
  if (value.createToken !== null || value.startToken !== null || value.runtimeId !== null) throw new Failure('conflict');
}
function abortUnstarted(db: DatabaseSync, value: Reservation): Reservation {
  requireUnstarted(value);
  return saveReservation(db, { ...value, status: 'released', aborted: true, launchClosed: true });
}
export function ownershipCommand(db: DatabaseSync, input: OwnershipCommand): AdmissionValue {
  if (input.kind === 'release') return releaseCommand(db, input.evidence);
  if (input.kind === 'settleLaunch') return settleLaunch(db, input.settlement);
  const value = reservation(db, input.key);
  switch (input.kind) {
    case 'reservation': return value;
    case 'claimCreate': return createClaim(db, value, input.specDigest);
    case 'bindRuntime': return bind(db, value, input);
    case 'claimStart': return startClaim(db, value, input);
    case 'abortUnstarted': return abortUnstarted(db, value);
  }
}
function releaseCommand(db: DatabaseSync, evidence: ReleaseEvidence): Reservation {
  const value = reservation(db, evidence.key);
  if (value.status === 'charged' && (evidence.collection.state === 'finished'
    || db.prepare('SELECT 1 FROM output_collection_intents WHERE attempt_id=?').get(value.attemptId))) throw new Failure('conflict');
  return releaseSettled(db, evidence);
}
