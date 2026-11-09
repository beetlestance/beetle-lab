import type { DatabaseSync } from 'node:sqlite';
import type { AttemptAdmission } from '@beetle/contracts';
import { validate } from '@beetle/contracts';
import type { Candidate, Reservation, Scope } from '../admission/index.js';
import { admissionInput } from './admission-input.js';
import { resourceNames, validResources, supportedStaging, MAX_RESOURCE_VALUE } from '../admission/index.js';
import { canonical } from './input.js';
import { requireLaunchBinding, requireSettledRelease } from './launch-settlement.js';
import { requireUnstarted } from './ownership.js';
import { Failure } from './sql.js';
import type { Row } from './sql.js';

function requireFact(condition: unknown): asserts condition {
  if (!condition) throw new Failure('unavailable');
}
function integer(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function token(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128;
}
function contractToken(value: unknown): boolean {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value);
}
function sameScope(value: Scope, row: Row): void {
  requireFact(value.attemptId === row.attempt_id && value.organizationId === row.organization_id
    && value.workspaceId === row.workspace_id && value.generation === row.generation);
}
function parse(raw: unknown): unknown {
  requireFact(typeof raw === 'string');
  return JSON.parse(raw) as unknown;
}
function keys(value: object, expected: readonly string[]): void {
  requireFact(canonical(Object.keys(value).sort()) === canonical([...expected].sort()));
}
function digest(value: unknown): boolean {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}
function candidateBudget(item: Candidate): void {
  requireFact(item.resources && validResources(item.resources));
  keys(item.resources, resourceNames);
  requireFact(resourceNames.every(name => item.resources[name] <= MAX_RESOURCE_VALUE));
  const budgetNames = ['cpuMillis', 'memoryBytes', 'pids', 'outputBytes', 'timeoutMs'] as const;
  requireFact(item.budget); keys(item.budget, budgetNames);
  requireFact(budgetNames.every(name => integer(item.budget[name]) && item.budget[name] > 0));
  requireFact(budgetNames.filter(name => name !== 'timeoutMs').every(name => item.budget[name] === item.resources[name]));
  requireFact(supportedStaging(item.staging, item.resources.stagingBytes));
  keys(item.staging, ['policyVersion', 'offerBytes', 'inputBytes', 'secretBytes', 'manifestBytes', 'metadataBytes', 'totalBytes']);
}
function candidateIdentity(item: Candidate): void {
  const { engine, validation } = item;
  requireFact(engine && validation);
  keys(engine, ['id', 'imageDigest', 'configVersion']);
  keys(validation, ['manifestId', 'profileId', 'schemaDigest', 'configDigest', 'catalogVersion']);
  requireFact(contractToken(engine.id) && typeof engine.imageDigest === 'string' && /^sha256:[a-f0-9]{64}$/.test(engine.imageDigest));
  requireFact(integer(engine.configVersion) && engine.configVersion > 0);
  requireFact(token(validation.manifestId) && token(validation.profileId));
  requireFact(digest(validation.schemaDigest) && digest(validation.configDigest));
  requireFact(integer(validation.catalogVersion) && validation.catalogVersion > 0);
}
function queueCandidate(row: Row, raw: unknown): Candidate {
  const item = parse(raw) as Candidate;
  requireFact(item && typeof item === 'object'); sameScope(item, row);
  keys(item, ['attemptId', 'organizationId', 'workspaceId', 'generation', 'staging', 'resources', 'budget',
    'mode', 'preferIdle', 'requiredCapabilities', 'engine', 'validation', 'queuedAt', 'order']);
  requireFact(item.queuedAt === null || integer(item.queuedAt));
  requireFact(item.order === 0 && typeof item.preferIdle === 'boolean');
  requireFact(item.mode === 'parallel' || item.mode === 'isolated');
  requireFact(Array.isArray(item.requiredCapabilities) && item.requiredCapabilities.length <= 64);
  requireFact(item.requiredCapabilities.every(contractToken));
  candidateBudget(item); candidateIdentity(item);
  return item;
}
function reservationShape(value: Reservation, candidate: Candidate): void {
  const { status, admittedAt } = value;
  const privateFields = ['status', 'admittedAt', 'createToken', 'specDigest', 'runtimeId', 'startToken',
    'launchEpoch', 'startClaimedAt', 'launchClosed', 'launchSettlement', 'aborted', 'releaseEvidence'];
  const stored = Object.fromEntries(Object.entries(value).filter(([name]) => !privateFields.includes(name)));
  requireFact(canonical(stored) === canonical(candidate));
  requireFact((status === 'charged' || status === 'released') && integer(admittedAt));
  requireFact(candidate.queuedAt === null || admittedAt >= candidate.queuedAt);
  claimShape(value); launchShape(value);
}
function claimShape({ createToken, specDigest, runtimeId }: Reservation): void {
  requireFact(createToken === null || token(createToken));
  requireFact(specDigest === null || typeof specDigest === 'string' && /^[a-f0-9]{64}$/.test(specDigest));
  requireFact((createToken === null) === (specDigest === null));
  requireFact(runtimeId === null || token(runtimeId) && createToken !== null);
}
function launchShape(value: Reservation): void {
  const { startToken, runtimeId, launchEpoch, startClaimedAt, admittedAt, launchClosed, aborted, launchSettlement } = value;
  requireFact(startToken === null || token(startToken) && runtimeId !== null);
  requireFact(startToken === null ? launchEpoch === 0 && startClaimedAt === null
    : launchEpoch === 1 && integer(startClaimedAt) && startClaimedAt >= admittedAt);
  requireFact(typeof launchClosed === 'boolean' && typeof aborted === 'boolean');
  requireFact(launchClosed === (aborted || launchSettlement !== null));
  dispositionShape(value);
}
function dispositionShape({ aborted, status, launchSettlement, releaseEvidence }: Reservation): void {
  requireFact(!aborted || status === 'released' && launchSettlement === null && releaseEvidence === null);
  requireFact(status !== 'charged' || releaseEvidence === null && !aborted);
}
function reservationFact(value: Reservation, row: Row): AttemptAdmission {
  if (value.launchSettlement !== null) {
    admissionInput({ kind: 'settleLaunch', settlement: value.launchSettlement });
    sameScope(value.launchSettlement.key, row);
    requireLaunchBinding(value, value.launchSettlement);
  }
  if (value.status === 'charged') return { state: 'charged' };
  if (value.aborted) {
    requireUnstarted(value);
    return { state: 'released', disposition: 'never_started' };
  }
  requireFact(value.releaseEvidence !== null);
  admissionInput({ kind: 'release', evidence: value.releaseEvidence });
  sameScope(value.releaseEvidence.key, row);
  requireSettledRelease(value, value.releaseEvidence);
  return { state: 'released', disposition: 'settled' };
}
function project(db: DatabaseSync, row: Row): AttemptAdmission | undefined {
  // SQLite bounds UTF-8 bytes before any payload crosses the native boundary.
  const queue = db.prepare(`SELECT id,pending,
    CASE WHEN length(CAST(candidate_json AS BLOB))<=16384 THEN candidate_json END AS candidate_json,
    CASE WHEN length(CAST(decision_json AS BLOB))<=512 THEN decision_json END AS decision_json,
    decision_json IS NOT NULL AS has_decision FROM admission_queue WHERE attempt_id=?`).get(row.attempt_id);
  const reserved = db.prepare(`SELECT charged,
    CASE WHEN length(CAST(reservation_json AS BLOB))<=32768 THEN reservation_json END AS reservation_json
    FROM reservations WHERE attempt_id=?`).get(row.attempt_id);
  if (!queue && !reserved) return undefined;
  requireFact(queue && integer(queue.id) && queue.id > 0);
  const item = queueCandidate(row, queue.candidate_json);
  requireFact(queue.pending === 0 || queue.pending === 1);
  if (reserved) {
    requireFact(queue.pending === 0 && queue.has_decision === 0);
    const value = parse(reserved.reservation_json) as Reservation;
    requireFact(value && typeof value === 'object');
    reservationShape(value, { ...item, order: queue.id });
    requireFact(reserved.charged === (value.status === 'charged' ? 1 : 0));
    return reservationFact(value, row);
  }
  return queueFact(queue, row);
}
function queueFact(queue: { pending?: unknown; has_decision?: unknown; decision_json?: unknown }, row: Row): AttemptAdmission {
  if (queue.pending === 1) {
    requireFact(queue.has_decision === 0 && row.cancel_requested === 0);
    return { state: 'queued' };
  }
  const decision = parse(queue.decision_json) as { kind: string; reason: string };
  requireFact(decision && decision.kind === 'reject');
  requireFact(canonical(decision) === canonical({ kind: 'reject', reason: decision.reason }));
  const fact = { state: 'rejected' as const, reason: decision.reason };
  requireFact(validate('AttemptAdmission', fact).ok);
  requireFact(decision.reason !== 'cancelled' || row.cancel_requested === 1);
  return fact as AttemptAdmission;
}

/** Stored corruption has no public fallback and grants no admission authority. */
export function admissionSnapshot(db: DatabaseSync, row: Row): AttemptAdmission | undefined {
  try { return project(db, row); }
  catch { throw new Failure('unavailable'); }
}
