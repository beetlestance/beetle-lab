import type { DatabaseSync } from 'node:sqlite';
import { encodeJson } from '@beetle/contracts';
import type { AdmissionCommand, Candidate, Decision } from '../admission/index.js';
import { admissionSnapshot } from './admission-snapshot.js';
import { offerInput } from './input.js';
import { offerAtomic } from './offers.js';
import { owner } from './sql.js';

/** The caller's admission transaction owns both original custody and final refusal. */
export function persistRefusal(db: DatabaseSync, input: {
  request: Extract<AdmissionCommand, { kind: 'offer' }>;
  metadata: Candidate;
  decision: Exclude<Decision, { kind: 'admit' }>;
  quota: number;
}): Decision {
  const { request, metadata, decision, quota } = input;
  offerAtomic(db, offerInput(request.offer), quota, request.assignment);
  db.prepare('INSERT INTO admission_queue(attempt_id,candidate_json,pending,decision_json) VALUES (?,?,0,?)')
    .run(request.offer.attemptId, encodeJson(metadata, 16_384), encodeJson(decision, 512));
  // Reuse the read authority before commit; unrepresentable facts roll back together.
  admissionSnapshot(db, owner(db, request.offer));
  db.prepare('UPDATE admission_settings SET last_clock=MAX(last_clock,?) WHERE id=1').run(request.now);
  return decision;
}
