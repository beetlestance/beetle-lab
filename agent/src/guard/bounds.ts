import { RuntimePlan } from '../backends/docker/index.js';
import { copyControlScope } from '../control-protocol/index.js';
import type { OutputScanResult } from '../staging/index.js';
import { GuardError } from './types.js';
import type { OutputGuardOptions, OutputWatchRequest } from './types.js';

export function fields(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object') throw new GuardError('invalid_input');
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(descriptors).length > 16) throw new GuardError('invalid_input');
  const result: Record<string, unknown> = {};
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!('value' in descriptor)) throw new GuardError('invalid_input');
    result[key] = descriptor.value as unknown;
  }
  return result;
}
export function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new GuardError('invalid_input');
  }
  return value;
}
export function optionsCopy(input: OutputGuardOptions): Required<OutputGuardOptions> {
  const value = fields(input);
  const intervalMs = integer(value.intervalMs ?? 250, 50, 5000);
  const ttlMs = integer(value.ttlMs ?? 2000, 100, 300000);
  const sampleTimeoutMs = integer(value.sampleTimeoutMs ?? 1000, 100, 30000);
  if (ttlMs <= intervalMs || typeof value.stop !== 'function'
    || (value.monotonicNow !== undefined && typeof value.monotonicNow !== 'function')) throw new GuardError('invalid_input');
  return Object.freeze({ root: value.root as OutputGuardOptions['root'], minimumFreeBytes: integer(value.minimumFreeBytes), intervalMs, ttlMs,
    sampleTimeoutMs, stop: value.stop as OutputGuardOptions['stop'],
    monotonicNow: (value.monotonicNow ?? (() => performance.now())) as () => number });
}
export function requestCopy(input: OutputWatchRequest): OutputWatchRequest {
  const value = fields(input);
  const key = copyControlScope(value.key);
  if (!(value.plan instanceof RuntimePlan) || !Object.isFrozen(value.plan)) throw new GuardError('invalid_input');
  return Object.freeze({ key, plan: value.plan, outputBytes: integer(value.outputBytes, 1) });
}
export function resultCopy(input: OutputScanResult): OutputScanResult {
  const value = fields(input);
  if (value.kind === 'unknown') {
    const reasons = ['invalid_input', 'busy', 'cancelled', 'deadline', 'io', 'custody', 'bounds', 'cleanup'];
    if (!reasons.includes(value.reason as string)) throw new GuardError('invalid_input');
    return { kind: 'unknown', reason: value.reason as 'io' };
  }
  if (typeof value.startedAt !== 'number' || !Number.isFinite(value.startedAt) || value.startedAt < 0) throw new GuardError('invalid_input');
  if (value.kind === 'limit' && (value.reason === 'output' || value.reason === 'disk')) {
    return { kind: 'limit', startedAt: value.startedAt, reason: value.reason };
  }
  if (value.kind !== 'known') throw new GuardError('invalid_input');
  return { kind: 'known', startedAt: value.startedAt, logicalBytes: integer(value.logicalBytes),
    allocatedBytes: integer(value.allocatedBytes), chargedBytes: integer(value.chargedBytes), freeBytes: integer(value.freeBytes) };
}
export function identity(request: OutputWatchRequest): string { return JSON.stringify(request.key); }
