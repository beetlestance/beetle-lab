import { validatePrimitive } from '@beetle/contracts';
import { isRuntimePlan, runtimeName } from '../backends/docker/index.js';
import type { RuntimePlan } from '../backends/docker/index.js';
import type { Reservation, Scope } from '../admission/index.js';
import type { LaunchInput, OfferAuthority } from './types.js';
import { SupervisorError } from './types.js';

export function identity(key: Scope): string {
  return [key.organizationId, key.workspaceId, key.attemptId, key.generation].join('/').toLowerCase();
}
export function sameScope(left: Scope, right: Scope): boolean {
  return left.organizationId === right.organizationId && left.workspaceId === right.workspaceId
    && left.attemptId === right.attemptId && left.generation === right.generation;
}
export function validateInput(input: LaunchInput, installationId: string): void {
  const { key, plan } = input;
  if (![key.organizationId, key.workspaceId, key.attemptId, installationId].every(value => validatePrimitive('uuid', value).ok)
    || !Number.isSafeInteger(key.generation) || key.generation < 1 || !isRuntimePlan(plan)) {
    throw new SupervisorError('invalid_input');
  }
  const labels = plan.spec.Labels;
  const expected = { installation: installationId.toLowerCase(), organization: key.organizationId.toLowerCase(),
    workspace: key.workspaceId.toLowerCase(), attempt: key.attemptId.toLowerCase(), generation: String(key.generation), spec: plan.specDigest };
  if (Object.entries(expected).some(([name, value]) => labels[`dev.beetle.${name}`] !== value)
    || plan.name !== runtimeName({ ...key, installationId })) throw new SupervisorError('conflict');
}
export function validateReservation(input: LaunchInput, reservation: Reservation, offer: OfferAuthority): void {
  const { key, plan } = input;
  if (!sameScope(key, reservation) || !sameScope(key, { ...offer, generation: key.generation })
    || reservation.status !== 'charged' || reservation.aborted) throw new SupervisorError('conflict');
  if (reservation.specDigest !== null && reservation.specDigest !== plan.specDigest) throw new SupervisorError('conflict');
  if (offer.intentDigest !== plan.spec.Labels['dev.beetle.intent'] || offer.engine.imageDigest !== plan.spec.Image
    || !sameBudget(offer, reservation)) throw new SupervisorError('conflict');
  validateControls(plan, offer);
}
function validateControls(plan: RuntimePlan, offer: OfferAuthority): void {
  const host = plan.spec.HostConfig;
  if (host.NanoCpus !== offer.budget.cpuMillis * 1_000_000 || host.Memory !== offer.budget.memoryBytes
    || host.PidsLimit !== offer.budget.pids) throw new SupervisorError('conflict');
}
function sameBudget(offer: OfferAuthority, reservation: Reservation): boolean {
  return (['cpuMillis', 'memoryBytes', 'pids', 'timeoutMs', 'outputBytes'] as const)
    .every(name => offer.budget[name] === reservation.budget[name]);
}
