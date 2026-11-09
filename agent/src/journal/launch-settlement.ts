import type { DatabaseSync } from 'node:sqlite';
import type { LaunchSettlement, ReleaseEvidence, Reservation } from '../admission/index.js';
import { reservation, saveReservation } from './admission-data.js';
import { canonical } from './input.js';
import { active, binding } from './ownership-checks.js';
import { Failure } from './sql.js';

function currentLaunch(value: Reservation, input: { epoch: number; startToken: string | null }): void {
  if (value.launchEpoch !== input.epoch || value.startToken !== input.startToken) throw new Failure('conflict');
}
function settledChronology(value: Reservation, input: LaunchSettlement): void {
  if (value.launchSettlement && input.settledAt <= value.launchSettlement.settledAt) throw new Failure('conflict');
}
export function settleLaunch(db: DatabaseSync, input: LaunchSettlement): Reservation {
  const value = reservation(db, input.key); requireLaunchBinding(value, input);
  const existing = value.launchSettlement;
  if (existing) {
    if (canonical(existing) === canonical(input)) return value;
    if (existing.disposition !== 'unknown') throw new Failure('conflict');
  }
  active(value); settledChronology(value, input);
  // A trusted definitive assertion means every create/start dispatch has quiesced
  // and its capability is retired. This persistence boundary cannot observe that.
  return saveReservation(db, { ...value, launchClosed: true, launchSettlement: input });
}
export function requireLaunchBinding(value: Reservation, input: LaunchSettlement): void {
  binding(value, input); currentLaunch(value, input);
  if (value.runtimeId !== input.runtimeId) throw new Failure('conflict');
  if (input.settledAt < (value.startClaimedAt ?? value.admittedAt)) throw new Failure('invalid_input');
}
function releaseChronology(value: Reservation, input: ReleaseEvidence): void {
  const settled = value.launchSettlement;
  if (!value.launchClosed || !settled || settled.disposition === 'unknown') throw new Failure('conflict');
  currentLaunch(value, input.launch);
  if (input.launch.settlementId !== settled.evidenceId) throw new Failure('conflict');
  // Strict ordering also rejects ambiguous same-millisecond pre-settlement samples.
  if (input.runtime.observedAt <= settled.settledAt || input.collection.observedAt <= settled.settledAt) {
    throw new Failure('invalid_input');
  }
}
export function releaseSettled(db: DatabaseSync, evidence: ReleaseEvidence): Reservation {
  const value = reservation(db, evidence.key); requireSettledRelease(value, evidence);
  if (value.releaseEvidence) {
    if (canonical(value.releaseEvidence) !== canonical(evidence)) throw new Failure('conflict');
    return value;
  }
  active(value);
  return saveReservation(db, { ...value, status: 'released', releaseEvidence: evidence });
}
export function requireSettledRelease(value: Reservation, evidence: ReleaseEvidence): void {
  binding(value, evidence);
  if (value.runtimeId !== evidence.runtimeId) throw new Failure('conflict');
  releaseChronology(value, evidence);
}
