import { copyControlScope } from '../control-protocol/index.js';
import type { Scope } from '../admission/index.js';
import type { TimeoutOptions, TimeoutRequest } from './types.js';
import { TimeoutError } from './types.js';

function fields(input: unknown, names: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TimeoutError('invalid_input');
  const result: Record<string, unknown> = {};
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(input, name);
    if (descriptor && !('value' in descriptor)) throw new TimeoutError('invalid_input');
    result[name] = descriptor?.value;
  }
  return result;
}
function integer(input: unknown, minimum: number, maximum = 8_640_000_000_000_000): input is number {
  return typeof input === 'number' && Number.isSafeInteger(input) && input >= minimum && input <= maximum;
}
export function requestCopy(input: TimeoutRequest): Readonly<TimeoutRequest> {
  try {
    const value = fields(input, ['key', 'admittedAt', 'timeoutMs', 'clockHighWater', 'clockFenced', 'sampledAt']);
    const key = copyControlScope(fields(value.key, ['attemptId', 'organizationId', 'workspaceId', 'generation']));
    if (!integer(value.admittedAt, 0) || !integer(value.timeoutMs, 1)
      || !integer(value.clockHighWater, value.admittedAt, Number.MAX_SAFE_INTEGER)
      || typeof value.clockFenced !== 'boolean' || typeof value.sampledAt !== 'number'
      || !Number.isFinite(value.sampledAt) || value.sampledAt < 0) throw new TimeoutError('invalid_input');
    return Object.freeze({ key, admittedAt: value.admittedAt, timeoutMs: value.timeoutMs,
      clockHighWater: value.clockHighWater, clockFenced: value.clockFenced, sampledAt: value.sampledAt });
  } catch { throw new TimeoutError('invalid_input'); }
}
export function optionsCopy(input: TimeoutOptions): Required<TimeoutOptions> {
  try {
    const value = fields(input, ['intervalMs', 'wallNow', 'monotonicNow', 'stop']);
    const intervalMs = value.intervalMs ?? 100;
    const wallNow = value.wallNow ?? Date.now;
    const monotonicNow = value.monotonicNow ?? (() => performance.now());
    if (!integer(intervalMs, 10, 1000) || typeof wallNow !== 'function'
      || typeof monotonicNow !== 'function' || typeof value.stop !== 'function') throw new TimeoutError('invalid_input');
    return Object.freeze({ intervalMs, wallNow: wallNow as () => number, monotonicNow: monotonicNow as () => number,
      stop: value.stop as TimeoutOptions['stop'] });
  } catch { throw new TimeoutError('invalid_input'); }
}
export function identity(key: Scope): string {
  return [key.organizationId, key.workspaceId, key.attemptId, key.generation].join('/').toLowerCase();
}
