import type { DatabaseSync } from 'node:sqlite';
import { encodeJson } from '@beetle/contracts';
import type { AdmissionCommand, AdmissionValue, Candidate, Decision, Reservation, RuntimeObservation } from '../admission/index.js';
import { decideAdmission, validateCandidate, DISK_HOLD_METADATA_BYTES } from '../admission/index.js';
import { admissionInput } from './admission-input.js';
import { projectCandidate } from './admission-candidate.js';
import { candidate, findReservation, settings, storedObservation } from './admission-data.js';
import { ownershipCommand } from './ownership.js';
import { canonical, offerInput } from './input.js';
import { offerAtomic } from './offers.js';
import { eventInput } from './event-input.js';
import { appendAtomic } from './spool.js';
import { Failure, owner, transaction } from './sql.js';
import { diskRetention } from './disk-retention/facts.js';

function mergeSensors(incoming: RuntimeObservation, old: RuntimeObservation | null): RuntimeObservation {
  if (!old) return incoming;
  return { ...incoming, ...olderIdle(incoming, old), ...olderThermal(incoming, old) };
}
function olderIdle(incoming: RuntimeObservation, old: RuntimeObservation): Partial<RuntimeObservation> {
  return old.idle && (!incoming.idle || incoming.idle.observedAt < old.idle.observedAt) ? { idle: old.idle } : {};
}
function olderThermal(incoming: RuntimeObservation, old: RuntimeObservation): Partial<RuntimeObservation> {
  return old.thermal && (!incoming.thermal || incoming.thermal.observedAt < old.thermal.observedAt) ? { thermal: old.thermal } : {};
}
function equalObservation(incoming: RuntimeObservation, old: RuntimeObservation): RuntimeObservation | null {
  if (canonical(incoming) === canonical(old)) return null;
  const { guards: _guards, ...retained } = old; void _guards;
  // Coarse timestamps cannot order conflicting facts. Never retain readiness or upgrade.
  return { ...retained, status: 'unknown' };
}
export class AdmissionStore {
  constructor(private readonly db: DatabaseSync, private readonly quota: number) {}
  execute(request: AdmissionCommand): AdmissionValue {
    let checked: AdmissionCommand;
    try { checked = admissionInput(request); } catch { throw new Failure('invalid_input'); }
    return transaction(this.db, () => this.executeAtomic(checked));
  }
  private executeAtomic(request: AdmissionCommand): AdmissionValue {
    switch (request.kind) {
      case 'configure':
        this.db.prepare('UPDATE admission_settings SET configuration_json=? WHERE id=1')
          .run(encodeJson(request.configuration, 65_536)); return { stored: true };
      case 'observe': return this.observe(request);
      case 'offer': return this.offer(request);
      case 'admit': return this.admit(request);
      case 'reservations': return this.page(request);
      default: return ownershipCommand(this.db, request);
    }
  }
  private observe(request: Extract<AdmissionCommand, { kind: 'observe' }>): AdmissionValue {
    const row = this.db.prepare('SELECT observation_json FROM admission_settings WHERE id=1').get();
    const old = storedObservation(row?.observation_json);
    if (old && old.observedAt > request.observation.observedAt) return { stored: false };
    const next = old?.observedAt === request.observation.observedAt
      ? equalObservation(request.observation, old) : mergeSensors(request.observation, old);
    if (!next) return { stored: false };
    this.db.prepare('UPDATE admission_settings SET observation_json=? WHERE id=1')
      .run(encodeJson(next, 65_536)); return { stored: true };
  }
  private offer(request: Extract<AdmissionCommand, { kind: 'offer' }>): AdmissionValue {
    const offer = request.offer;
    const old = this.db.prepare('SELECT candidate_json,decision_json FROM admission_queue WHERE attempt_id=?').get(offer.attemptId);
    if (old) return this.replayOffer(request, old);
    const snapshot = settings(this.db, request.now);
    const legacy = this.legacyOffer(request);
    if (legacy.cancelled) return { kind: 'reject', reason: 'cancelled' };
    const metadata = projectCandidate(request, legacy.exists, snapshot.lastClock);
    if (!metadata) return { kind: 'reject', reason: 'impossible_request' };
    const validation = validateCandidate(metadata, snapshot);
    if (validation.kind !== 'admit') return validation;
    const current = decideAdmission(metadata, snapshot, diskRetention(this.db));
    if (current.kind === 'reject') return current;
    const count = Number(this.db.prepare('SELECT count(*) AS n FROM admission_queue WHERE pending=1').get()?.n);
    if (count >= 1024) return { kind: 'defer', reason: 'pending_full' };
    offerAtomic(this.db, offerInput(offer), this.quota);
    this.db.prepare('INSERT INTO admission_queue(attempt_id,candidate_json) VALUES (?,?)')
      .run(offer.attemptId, encodeJson(metadata, 16_384));
    this.db.prepare('UPDATE admission_settings SET last_clock=MAX(last_clock,?) WHERE id=1').run(request.now);
    return { kind: 'defer', reason: 'queued' };
  }
  private legacyOffer(request: Extract<AdmissionCommand, { kind: 'offer' }>): { exists: boolean; cancelled: boolean } {
    const row = this.db.prepare('SELECT id,cancel_requested FROM accepted_attempts WHERE attempt_id=?').get(request.offer.attemptId);
    if (row) offerAtomic(this.db, offerInput(request.offer), this.quota);
    return { exists: Boolean(row), cancelled: row?.cancel_requested === 1 };
  }
  private replayOffer(request: Extract<AdmissionCommand, { kind: 'offer' }>, row: { candidate_json?: unknown; decision_json?: unknown }): AdmissionValue {
    offerAtomic(this.db, offerInput(request.offer), this.quota);
    const old = JSON.parse(row.candidate_json as string) as Candidate;
    if (canonical(old.validation) !== canonical(request.validation)) throw new Failure('conflict');
    const key = { ...request.offer, generation: 1 };
    if (typeof row.decision_json === 'string') return JSON.parse(row.decision_json) as Decision;
    return findReservation(this.db, key) ?? { kind: 'defer', reason: 'queued' };
  }
  private admit(request: Extract<AdmissionCommand, { kind: 'admit' }>): AdmissionValue {
    const existing = findReservation(this.db, request.key);
    if (existing) return existing;
    if (owner(this.db, request.key).cancel_requested) return { kind: 'reject', reason: 'cancelled' };
    const item = candidate(this.db, request.key);
    const snapshot = settings(this.db, request.now);
    if (snapshot.queue.length === 100 && item.order > (snapshot.queue[99]?.order ?? 0)) return { kind: 'defer', reason: 'scan_window' };
    const decision = decideAdmission(item, snapshot, diskRetention(this.db));
    this.db.prepare('UPDATE admission_settings SET last_clock=MAX(last_clock,?) WHERE id=1').run(request.now);
    if (decision.kind === 'reject') return this.reject(item, decision);
    if (decision.kind !== 'admit') return decision;
    const row = owner(this.db, request.key);
    if (row.spool_bytes + row.snapshot_bytes + row.checkpoint_bytes + DISK_HOLD_METADATA_BYTES > row.quota_bytes) {
      throw new Failure('quota_exceeded');
    }
    const reservation: Reservation = { ...item, status: 'charged', admittedAt: request.now, createToken: null,
      specDigest: null, runtimeId: null, startToken: null, launchEpoch: 0, startClaimedAt: null,
      launchClosed: false, launchSettlement: null, aborted: false, releaseEvidence: null };
    this.db.prepare('INSERT INTO reservations(attempt_id,reservation_json,charged) VALUES (?,?,1)')
      .run(item.attemptId, encodeJson(reservation, 32_768));
    appendAtomic(this.db, eventInput({ sourceOrdinal: request.sourceOrdinal, event: {
      version: '1.0', ...request.key, source: 'agent', phase: 'prepare',
      observedAt: new Date(request.now).toISOString(), kind: 'admitted', payload: { budget: item.budget },
    } }, 'agent'));
    this.db.prepare('UPDATE admission_queue SET pending=0 WHERE attempt_id=?').run(item.attemptId);
    return reservation;
  }
  private reject(item: Candidate, decision: Decision): Decision {
    this.db.prepare('UPDATE admission_queue SET pending=0,decision_json=? WHERE attempt_id=?')
      .run(encodeJson(decision, 512), item.attemptId); return decision;
  }
  private page(request: Extract<AdmissionCommand, { kind: 'reservations' }>): AdmissionValue {
    const rows = this.db.prepare('SELECT id,reservation_json FROM reservations WHERE id>? ORDER BY id LIMIT ?')
      .all(request.cursor ?? 0, request.limit + 1);
    const reservations = rows.slice(0, request.limit).map(row => JSON.parse(row.reservation_json as string) as Reservation);
    return rows.length > request.limit ? { reservations, cursor: Number(rows[request.limit - 1]?.id) } : { reservations };
  }
}
