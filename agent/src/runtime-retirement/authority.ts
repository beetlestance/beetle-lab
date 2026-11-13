import { encodeCanonicalJson } from '@beetle/contracts';
import type { AttemptSnapshot } from '@beetle/contracts';
import type { AdmissionValue, Reservation } from '../admission/index.js';
import { producerBarrierFacts } from '../producer-retirement/index.js';
import type { ProducerBarrier } from '../producer-retirement/index.js';
import { boundRootNamespace, verifiedDaemonIdentity } from '../staging/index.js';
import { recoverRuntimePlan } from '../installation/index.js';
import type { RuntimeRetirementOptions } from './types.js';
import { RuntimeRetirementError } from './types.js';
import type { RetirementIntent } from '../retirement-values/index.js';
export function producerIntent(options: RuntimeRetirementOptions, producer: ProducerBarrier): RetirementIntent {
  const { intent } = producerBarrierFacts(producer, options.journal.retirements);
  if (intent.namespaceIdentity !== boundRootNamespace(options.root).namespaceIdentity) throw new RuntimeRetirementError('conflict'); return intent;
}
export function runtimeKey(intent: RetirementIntent) {
  const { organizationId, workspaceId, attemptId, generation } = intent.request; return { organizationId, workspaceId, attemptId, generation };
}
function exactIntent(stored: RetirementIntent | null, current: RetirementIntent, intent: RetirementIntent): void {
  if (encodeCanonicalJson(stored, 4096) !== encodeCanonicalJson(intent, 4096)
    || encodeCanonicalJson(current, 4096) !== encodeCanonicalJson(intent, 4096)) throw new RuntimeRetirementError('conflict');
}
function neverStarted(value: Reservation): void {
  if (!value.aborted || value.createToken !== null || value.runtimeId !== null) throw new RuntimeRetirementError('conflict');
}
function releasedOriginal(snapshot: AttemptSnapshot, value: AdmissionValue): (Reservation & { runtimeId: string }) | null {
  if (!('status' in value) || value.status !== 'released' || snapshot.admission?.state !== 'released') throw new RuntimeRetirementError('conflict');
  if (snapshot.admission.disposition === 'never_started') {
    neverStarted(value); return null;
  }
  const runtimeId = value.runtimeId;
  if (typeof runtimeId !== 'string' || !/^[a-f0-9]{64}$/.test(runtimeId)) throw new RuntimeRetirementError('conflict');
  return Object.freeze({ ...value, runtimeId });
}
/** Reuse Journal eligibility rather than interpreting caller ACK/seal flags. */
export async function releasedRuntime(input: { options: RuntimeRetirementOptions; intent: RetirementIntent; check(): void }) {
  const { options, intent, check } = input; const key = runtimeKey(intent); check();
  const stored = await options.journal.retirements.read(key); check();
  const current = await options.journal.retirements.preflight(intent.request); check();
  exactIntent(stored, current, intent);
  const snapshot = await options.journal.get(key); check();
  const value = await options.journal.admission({ kind: 'reservation', key }); check();
  const original = releasedOriginal(snapshot, value); if (!original) return null;
  const offer = await options.journal.readOffer(key); check(); const plan = recoverRuntimePlan(options.catalog, offer, original); check();
  return Object.freeze({ plan, runtimeId: original.runtimeId, specDigest: plan.specDigest });
}
export function ownedDaemon(options: RuntimeRetirementOptions): string { return verifiedDaemonIdentity(options.root); }
