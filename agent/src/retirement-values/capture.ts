import { createHash } from 'node:crypto';
import { encodeJson, encodeCanonicalJson } from '@beetle/contracts';
import { captureOutputRetirementRequest, outputRetirementDigest } from '@beetle/contracts/output-retirement';
import type { RetirementRequest } from '@beetle/contracts/output-retirement';
import { cleanupControl, cleanupDigest } from '../cleanup-control/index.js';
import { captureTaskNamespaceState, namespaceCaps } from '../staging-namespace/index.js';
import type { TaskNamespaceState } from '../staging-namespace/index.js';
import type { RetirementIntent, RetirementTask } from './types.js';
export const retirementDigest = (text: string): string => createHash('sha256').update(text).digest('hex');
function requireValue(value: unknown): asserts value { if (!value) throw new Error('Invalid retirement intent'); }
function fields(input: unknown, expected: string[]): Record<string, unknown> {
  requireValue(input && typeof input === 'object' && !Array.isArray(input)); const value = input as Record<string, unknown>;
  requireValue(Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key))); return value;
}
export function captureRetirementTask(input: unknown): RetirementTask {
  const raw = JSON.parse(encodeJson(input, 512)) as Record<string, unknown>;
  if (raw?.state === 'none') { fields(raw, ['state']); return Object.freeze({ state: 'none' }); }
  fields(raw, raw?.state === 'preparing' ? ['state', 'intentIdentity'] : ['state', 'intentIdentity', 'taskNamespaceIdentity']);
  requireValue(cleanupDigest(raw.intentIdentity));
  if (raw.state === 'preparing') return Object.freeze({ state: 'preparing', intentIdentity: raw.intentIdentity });
  requireValue(raw.state === 'prepared' && cleanupDigest(raw.taskNamespaceIdentity));
  return Object.freeze({ state: 'prepared', intentIdentity: raw.intentIdentity, taskNamespaceIdentity: raw.taskNamespaceIdentity });
}
/** Snapshot of stored metadata only; never a native absence/drain capability. */
export function retirementTaskSnapshot(input: TaskNamespaceState | null): RetirementTask {
  const state = captureTaskNamespaceState(input); if (!state) return Object.freeze({ state: 'none' });
  const intentIdentity = retirementDigest(encodeCanonicalJson(state.intent, namespaceCaps.task));
  return state.state === 'preparing' ? Object.freeze({ state: 'preparing', intentIdentity })
    : Object.freeze({ state: 'prepared', intentIdentity, taskNamespaceIdentity: state.anchor.taskNamespaceIdentity });
}
export function makeRetirementIntent(input: { request: RetirementRequest; namespaceIdentity: string; task: RetirementTask }): RetirementIntent {
  return captureRetirementIntent({ protocolVersion: 1, retirementVersion: 1,
    request: input.request, requestDigest: outputRetirementDigest(input.request, retirementDigest),
    namespaceIdentity: input.namespaceIdentity, task: input.task });
}
export function captureRetirementIntent(input: unknown, expected?: RetirementRequest): RetirementIntent {
  const raw = fields(JSON.parse(encodeJson(input, cleanupControl.intentBytes)) as unknown,
    ['protocolVersion', 'retirementVersion', 'request', 'requestDigest', 'namespaceIdentity', 'task']);
  requireValue(raw.protocolVersion === 1 && raw.retirementVersion === 1 && cleanupDigest(raw.namespaceIdentity));
  const request = captureOutputRetirementRequest(raw.request);
  requireValue(raw.requestDigest === outputRetirementDigest(request, retirementDigest));
  if (expected) requireValue(encodeCanonicalJson(expected, cleanupControl.intentBytes) === encodeCanonicalJson(request, cleanupControl.intentBytes));
  return Object.freeze({ protocolVersion: 1, retirementVersion: 1, request, requestDigest: raw.requestDigest as string,
    namespaceIdentity: raw.namespaceIdentity, task: captureRetirementTask(raw.task) });
}
