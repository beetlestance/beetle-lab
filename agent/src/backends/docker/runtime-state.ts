import type { RuntimePlan } from './prepare.js';
import type { DockerTransport } from './types.js';
import { MailboxVolumeOwner } from './mailbox-volume.js';
import { performance } from 'node:perf_hooks';

import { containerId, record } from './inspect.js';
import type { DockerReply, FailureReason, InspectEvidence, MutationResult, Observation, Operation } from './types.js';
export interface Entry {
  readonly digest: string;
  readonly volume: MailboxVolumeOwner | undefined;
  volumeVerified: boolean;
  readers: number;
  removalClaimed: boolean;
  busy: boolean;
  createClaimed: boolean;
  creationSettled: boolean;
  startClaimed: boolean;
  retiredRuntimeId: string | undefined;
  running: boolean;
  cpuNs: number | null;
  runtimeId: string | undefined;
  terminal: boolean;
  removed: boolean;
  graceDeadline: number | undefined;
}
export interface Inspection {
  readonly observation: Observation;
  readonly runtimeIdAtIssue: string | undefined;
}
export const rejected = <T>(reason: FailureReason): MutationResult<T> => ({ outcome: 'rejected', reason });
export const uncertain = <T>(reason: FailureReason): MutationResult<T> => ({ outcome: 'unknown', reason });
export const known = <T>(value: T): MutationResult<T> => ({ outcome: 'known', value });
export function operationContext(operation: Operation): Operation | undefined {
  if (!operation || !Number.isFinite(operation.deadline)) return undefined;
  return {
    deadline: Math.min(operation.deadline, performance.now() + 30_000),
    ...(operation.signal ? { signal: operation.signal } : {}),
  };
}
export function absent(entry: Entry | undefined, runtimeIdAtIssue: string | undefined): Observation {
  if (!entry) return { state: 'unknown', reason: 'overflow' };
  if (entry.runtimeId !== runtimeIdAtIssue) return { state: 'unknown', reason: 'unsafe_state' };
  entry.running = false;
  if (runtimeIdAtIssue !== undefined && !entry.retiredRuntimeId) {
    entry.createClaimed = true;
    entry.startClaimed = true;
    entry.terminal = true;
  }
  return { state: 'missing' };
}
export function remember(entry: Entry, evidence: InspectEvidence): Observation {
  if (!retainIdentity(entry, evidence.id)) return { state: 'unknown', reason: 'conflict' };
  if (regressive(entry, evidence)) return { state: 'unknown', reason: 'unsafe_state' };
  entry.running = evidence.state === 'running';
  if (evidence.state !== 'created' && !entry.retiredRuntimeId) entry.startClaimed = true;
  if (evidence.state === 'exited') entry.terminal = true;
  return evidence;
}
export function retainIdentity(entry: Entry, id: string): boolean {
  if (entry.removed || (entry.runtimeId && entry.runtimeId !== id)) return false;
  entry.runtimeId ??= id;
  if (!entry.retiredRuntimeId) entry.createClaimed = true;
  return true;
}
export function createdId(body: unknown): string | undefined {
  const id = record(body)?.Id;
  return containerId(id) ? id : undefined;
}
export function regressive(entry: Entry, evidence: InspectEvidence): boolean {
  return (entry.terminal && evidence.state !== 'exited') || (entry.startClaimed && evidence.state === 'created');
}
export function current(entry: Entry, view: Inspection): Observation {
  const { observation, runtimeIdAtIssue } = view;
  if (observation.state === 'missing' && entry.runtimeId !== runtimeIdAtIssue)
    return { state: 'unknown', reason: 'unsafe_state' };
  if (!('id' in observation)) return observation;
  if (entry.removed || entry.runtimeId !== observation.id) return { state: 'unknown', reason: 'conflict' };
  return regressive(entry, observation) ? { state: 'unknown', reason: 'unsafe_state' } : observation;
}
export function stopped(observation: Observation): observation is InspectEvidence & { state: 'created' | 'exited' } {
  return observation.state === 'created' || observation.state === 'exited';
}
export function startFenced(entry: Entry): boolean {
  return !!entry.retiredRuntimeId || entry.startClaimed || entry.terminal || entry.removed;
}
export function existing(observation: Observation): MutationResult<InspectEvidence> {
  if (observation.state === 'unknown') return uncertain('reason' in observation ? observation.reason : 'unsafe_state');
  return 'id' in observation ? known(observation) : uncertain('conflict');
}
export function failedMutation(reply: Extract<DockerReply, { ok: false }>): MutationResult<never> {
  return reply.dispatched ? uncertain(reply.reason) : rejected(reply.reason);
}
export function statusFailure(status: number): MutationResult<never> {
  return [400, 401, 403, 404, 409].includes(status) ? rejected('rejected') : uncertain('unavailable');
}

export function createEntry(plan: RuntimePlan, transport: DockerTransport): Entry {
  return {
    digest: plan.specDigest,
    volume: plan.spec.HostConfig.Mounts.some((mount) => mount.Type === 'volume')
      ? new MailboxVolumeOwner(plan, transport)
      : undefined,
    volumeVerified: false,
    readers: 0,
    removalClaimed: false,
    busy: false,
    createClaimed: false,
    creationSettled: false,
    startClaimed: false,
    retiredRuntimeId: undefined,
    running: false,
    cpuNs: null,
    runtimeId: undefined,
    terminal: false,
    removed: false,
    graceDeadline: undefined,
  };
}
