import { encodeJson, validate, validatePrimitive } from '@beetle/contracts';
import type { Offer } from '@beetle/contracts';
import { estimateStaging, stagingPolicy, supportedStaging } from '../admission/index.js';
import type { Reservation, Scope, ValidationIdentity } from '../admission/index.js';
import { configDigest, JournalError } from '../journal/index.js';
import { freeze, snapshot } from './bounds.js';
import type { Boundary } from './bounds.js';
import { StagingError } from './types.js';
import type { Authority, StagerOptions } from './types.js';

export function scopeSnapshot(raw: Scope): Scope {
  const key = snapshot(raw, 1024);
  if (!['organizationId', 'workspaceId', 'attemptId'].every(field => validatePrimitive('uuid', key[field as keyof Scope]).ok)
    || !Number.isSafeInteger(key.generation) || key.generation < 1 || Object.keys(key).length !== 4) throw new StagingError('invalid_input');
  return key;
}
export function validationSnapshot(raw: Omit<ValidationIdentity, 'configDigest'>): Omit<ValidationIdentity, 'configDigest'> {
  const value = snapshot(raw, 4096);
  if (Object.keys(value).sort().join(',') !== 'catalogVersion,manifestId,profileId,schemaDigest') throw new StagingError('invalid_input');
  if (![value.manifestId, value.profileId].every(field => typeof field === 'string' && field.length > 0 && field.length <= 128)) throw new StagingError('invalid_input');
  if (!/^[a-f0-9]{64}$/u.test(value.schemaDigest) || !Number.isSafeInteger(value.catalogVersion) || value.catalogVersion < 1) throw new StagingError('invalid_input');
  return value;
}
function equal(left: unknown, right: unknown): boolean { return encodeJson(left, 4096) === encodeJson(right, 4096); }
function scoped(left: Scope, right: Scope): boolean {
  return left.generation === right.generation && ['organizationId', 'workspaceId', 'attemptId']
    .every(field => String(left[field as keyof Scope]).toLowerCase() === String(right[field as keyof Scope]).toLowerCase());
}
function checkedReservation(raw: unknown, offer: Offer, key: Scope, options: StagerOptions): Reservation {
  if (!raw || typeof raw !== 'object' || !('status' in raw)) throw new StagingError('reservation');
  const reservation = raw as Reservation;
  if (!scoped(reservation, key)) throw new StagingError('reservation');
  checkUnowned(reservation);
  checkIdentity(reservation, offer, options);
  const estimate = estimateStaging(offer);
  if (!supportedStaging(reservation.staging, reservation.resources.stagingBytes)
    || !Object.entries(estimate).every(([field, value]) => reservation.staging[field as keyof typeof estimate] === value)) throw new StagingError('reservation');
  return reservation;
}
function checkUnowned(reservation: Reservation): void {
  if (reservation.status !== 'charged' || reservation.aborted || reservation.launchClosed || reservation.launchEpoch !== 0) throw new StagingError('reservation');
  const empty = ['createToken', 'specDigest', 'runtimeId', 'startToken', 'startClaimedAt', 'launchSettlement', 'releaseEvidence'] as const;
  if (empty.some(field => reservation[field] !== null)) throw new StagingError('reservation');
}
function checkIdentity(reservation: Reservation, offer: Offer, options: StagerOptions): void {
  if (!equal(reservation.engine, offer.engine) || !equal(reservation.budget, offer.budget)) throw new StagingError('reservation');
  const vector = reservation.resources;
  if (!['cpuMillis', 'memoryBytes', 'pids', 'outputBytes'].every(field => vector[field as keyof typeof vector] === offer.budget[field as keyof Offer['budget']])) throw new StagingError('reservation');
  if (!Object.entries(options.validation).every(([field, value]) => reservation.validation[field as keyof typeof reservation.validation] === value)
    || reservation.validation.configDigest !== configDigest(offer.config)) throw new StagingError('reservation');
}
export function validateNames(offer: Offer): void {
  const ids = offer.inputs.map(input => input.id.toLowerCase());
  if (new Set(ids).size !== ids.length) throw new StagingError('invalid_input');
  const names = (offer.secretReferences ?? []).map(secret => secret.name.normalize('NFC').toLowerCase());
  if (new Set(names).size !== names.length || names.some(unsafeFilename)) throw new StagingError('invalid_input');
}
function unsafeFilename(name: string): boolean {
  const prohibited = '<>:"/\\|?*';
  return name.length === 0 || name.endsWith('.') || name.endsWith(' ')
    || Array.from(name).some(character => character.charCodeAt(0) < 32 || prohibited.includes(character))
    || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/u.test(name.split('.')[0]!);
}
export interface Authorized { readonly offer: Offer; readonly reservation: Reservation; readonly authority: Authority; readonly deadlineMs: number }
export async function authorize(options: StagerOptions, key: Scope, boundary: Boundary): Promise<Authorized> {
  const raw = await boundary.wait(() => options.journal.readOffer(key)).catch(error => {
    boundary.check();
    if (error instanceof JournalError && error.code === 'queue_full') throw new StagingError('busy');
    throw error;
  });
  const offer = validate('Offer', snapshot(raw, stagingPolicy.offerBytes));
  if (!offer.ok || !scoped({ ...offer.value, generation: key.generation }, key)) throw new StagingError('reservation');
  validateNames(offer.value);
  const rawReservation = await boundary.wait(() => options.journal.admission({ kind: 'reservation', key }));
  const reservation = checkedReservation(rawReservation, offer.value, key, options);
  const deadlineMs = reservation.admittedAt + offer.value.budget.timeoutMs;
  if (!Number.isSafeInteger(reservation.admittedAt) || reservation.admittedAt < 0
    || !Number.isSafeInteger(deadlineMs) || deadlineMs > 8_640_000_000_000_000) throw new StagingError('reservation');
  const authority = freeze({ ...key, installationId: options.profile.installationId, intentDigest: offer.value.intentDigest });
  return { offer: freeze(offer.value), reservation, authority, deadlineMs };
}
export async function eligibility(options: StagerOptions, authorized: Authorized, boundary: Boundary): Promise<void> {
  boundary.check();
  const now = (options.wallNow ?? Date.now)();
  if (!Number.isSafeInteger(now) || now < 0) throw new StagingError('clock_fenced');
  const state = await boundary.wait(() => options.journal.supervision({ key: authorized.authority, now }));
  if (state.cancelRequested) throw new StagingError('cancelled');
  if (state.clockFenced) throw new StagingError('clock_fenced');
  if (now >= authorized.deadlineMs || state.clockHighWater >= authorized.deadlineMs) throw new StagingError('deadline');
  const raw = await boundary.wait(() => options.journal.admission({ kind: 'reservation', key: authorized.authority }));
  const current = checkedReservation(raw, authorized.offer, authorized.authority, options);
  if (current.admittedAt !== authorized.reservation.admittedAt) throw new StagingError('reservation');
  await checkAttempt(options, authorized, boundary);
  boundary.check();
}
async function checkAttempt(options: StagerOptions, authorized: Authorized, boundary: Boundary): Promise<void> {
  const attempt = await boundary.wait(() => options.journal.get(authorized.authority));
  if (!scoped(attempt, authorized.authority)) throw new StagingError('reservation');
  if (attempt.intentDigest !== authorized.offer.intentDigest) throw new StagingError('reservation');
  if (!['admitted', 'preparing'].includes(attempt.state)) throw new StagingError('reservation');
  if (attempt.cancelRequested) throw new StagingError('cancelled');
  boundary.check();
}
