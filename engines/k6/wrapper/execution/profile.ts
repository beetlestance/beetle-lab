import { isAbsolute, resolve } from 'node:path';
import { validateAttempt } from '../../runtime/index.js';
import { ExecutionError } from './types.js';
import type { ExecutionClock, ExecutionOptions } from './types.js';

export const summaryReservationBytes = 1_048_576;
export interface AcceptedOptions extends ExecutionOptions { readonly clock: ExecutionClock }
function positive(value: number, maximum = Number.MAX_SAFE_INTEGER): boolean {
  return Number.isSafeInteger(value) && value >= 1 && value <= maximum;
}
function limits(input: ExecutionOptions['limits']): ExecutionOptions['limits'] {
  const value = Object.freeze({ maximumBuildBytes: input.maximumBuildBytes, reservedOutputBytes: input.reservedOutputBytes,
    maximumMetricBytes: input.maximumMetricBytes, maximumMetricRecords: input.maximumMetricRecords,
    maximumDiagnosticBytes: input.maximumDiagnosticBytes, drainTimeoutMs: input.drainTimeoutMs,
    collectionTimeoutMs: input.collectionTimeoutMs });
  const reserved = value.maximumBuildBytes + summaryReservationBytes;
  if (!positive(value.maximumBuildBytes) || !positive(value.reservedOutputBytes)
    || !Number.isSafeInteger(reserved) || reserved > value.reservedOutputBytes) throw new ExecutionError('profile');
  if (!positive(value.maximumMetricBytes) || !positive(value.maximumMetricRecords)
    || !positive(value.maximumDiagnosticBytes, 65_536) || !positive(value.drainTimeoutMs, 1000)
    || !positive(value.collectionTimeoutMs, 30_000)) throw new ExecutionError('profile');
  return value;
}
function path(value: string): string {
  if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value || value.includes('\0')) throw new ExecutionError('profile');
  return value;
}
function validateOwner(input: ExecutionOptions): void {
  if (!Number.isSafeInteger(input.uid) || input.uid < 0 || typeof input.window !== 'function'
    || typeof input.measureStarted !== 'function') throw new ExecutionError('profile');
  if (input.signal !== undefined && !(input.signal instanceof AbortSignal)) throw new ExecutionError('profile');
}
/** Trusted accepted suite identity is immutable; capture mutable launch options before callbacks. */
export function snapshot(input: ExecutionOptions): AcceptedOptions {
  const attempt = validateAttempt(input.compiled.attempt);
  if (attempt.mode !== 'managed' || attempt.deadlineMs > 8_640_000_000_000_000
    || attempt.deadlineMs - attempt.timeoutMs < 0) throw new ExecutionError('profile');
  validateOwner(input);
  const clock = input.clock ? { wall: input.clock.wall.bind(input.clock), monotonic: input.clock.monotonic.bind(input.clock) }
    : { wall: Date.now, monotonic: performance.now.bind(performance) };
  return Object.freeze({ compiled: Object.freeze({ suite: input.compiled.suite, attempt: Object.freeze(attempt) }),
    binary: path(input.binary), emptyConfig: path(input.emptyConfig), outputDirectory: path(input.outputDirectory),
    uid: input.uid, limits: limits(input.limits), window: input.window, measureStarted: input.measureStarted,
    ...(input.signal ? { signal: input.signal } : {}), clock: Object.freeze(clock) });
}
