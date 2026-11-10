import { randomUUID } from 'node:crypto';
import type { ReleaseEvidence, Reservation } from '../admission/index.js';
import type { LaunchState } from '../supervisor/index.js';
import type { CollectionObservation } from './types.js';

function bound(value: Reservation): boolean {
  return Boolean(value.createToken && value.specDigest && value.runtimeId && value.launchSettlement);
}
export function stoppedReservation(value: Reservation, state: LaunchState): boolean {
  if (state.cancellation === 'clock_integrity' || state.launch === 'unknown' || state.launch === 'unclaimed') return false;
  const view = state.observation;
  return view !== null && 'id' in view && view.id === value.runtimeId && ['created', 'exited'].includes(view.state);
}
/** A later observed stop plus definitive settled dispatches; no inferred launch retirement. */
export function releaseEvidence(input: { reservation: Reservation; state: LaunchState;
  collection: CollectionObservation; runtimeAt: number }): ReleaseEvidence | null {
  const { reservation: value, state, collection, runtimeAt } = input;
  const settled = value.launchSettlement;
  if (!bound(value) || !settled || settled.disposition === 'unknown' || !stoppedReservation(value, state)) return null;
  if (runtimeAt <= settled.settledAt || collection.observedAt <= settled.settledAt) return null;
  return { authority: 'supervisor', key: { organizationId: value.organizationId, workspaceId: value.workspaceId,
    attemptId: value.attemptId, generation: value.generation }, createToken: value.createToken!,
    specDigest: value.specDigest!, runtimeId: value.runtimeId!,
    runtime: { state: 'stopped', source: 'supervisor', observedAt: runtimeAt, evidenceId: randomUUID() },
    collection: { state: collection.state, observedAt: collection.observedAt, evidenceId: randomUUID() },
    launch: { epoch: value.launchEpoch, startToken: value.startToken, settlementId: settled.evidenceId } };
}
