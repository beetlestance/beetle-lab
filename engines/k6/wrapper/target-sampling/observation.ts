import { targetMetricNames } from './types.js';
import type { TargetMetricName, TargetSamplingOptions, TargetSamplingPhase,
  TargetSamplingReason, TargetSamplingSample } from './types.js';

class ObservationCleanupFailure extends Error {}
class ObservationFailure extends Error {
  constructor(readonly reason: TargetSamplingReason) { super(reason); }
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function values(source: unknown): Readonly<Record<TargetMetricName, number | null>> {
  const entries = targetMetricNames.map(name => {
    const value = name.split('.').reduce<unknown>((node, key) => record(node) ? node[key] : undefined, source);
    return [name, typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null];
  });
  return Object.freeze(Object.fromEntries(entries)) as Readonly<Record<TargetMetricName, number | null>>;
}
async function readBody(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.body) throw new ObservationFailure('invalid_json');
  const reader = response.body.getReader();
  let cancellation: Promise<boolean> | undefined;
  const cancel = () => { cancellation ??= reader.cancel().then(() => true, () => false); };
  const release = async () => {
    const cancelled = await cancellation;
    try { reader.releaseLock(); } catch { throw new ObservationCleanupFailure('reader_release'); }
    if (cancelled === false) throw new ObservationCleanupFailure('reader_cancel');
  };
  signal.addEventListener('abort', cancel, { once: true });
  const buffer = new Uint8Array(65536);
  let size = 0;
  try {
    if (signal.aborted) cancel();
    while (!signal.aborted) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (size + chunk.value.byteLength > buffer.length) throw new ObservationFailure('body_limit');
      buffer.set(chunk.value, size);
      size += chunk.value.byteLength;
    }
    if (signal.aborted) throw new ObservationFailure('cancelled');
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size))) as unknown; }
    catch { throw new ObservationFailure('invalid_json'); }
  } finally {
    signal.removeEventListener('abort', cancel);
    cancel();
    await release();
  }
}
async function request(options: TargetSamplingOptions, signal: AbortSignal): Promise<unknown> {
  const url = new URL(options.config.path.replace(/^\//, ''), `${options.target.replace(/\/$/, '')}/`);
  const response = await (options.fetch ?? globalThis.fetch)(url, {
    method: 'GET', redirect: 'error', credentials: 'omit', signal,
  });
  if (signal.aborted || !response.ok) {
    try { await response.body?.cancel(); }
    catch { throw new ObservationCleanupFailure('body_cancel'); }
    throw new ObservationFailure(signal.aborted ? 'cancelled' : 'http');
  }
  return readBody(response, signal);
}
function failureReason(error: unknown, signal: AbortSignal, timedOut: boolean): TargetSamplingReason {
  if (signal.aborted) return timedOut ? 'timeout' : 'cancelled';
  return error instanceof ObservationFailure ? error.reason : 'transport';
}
export async function observe(options: TargetSamplingOptions, phase: TargetSamplingPhase,
  signal: AbortSignal): Promise<TargetSamplingSample> {
  const controller = new AbortController();
  const abort = () => { clearTimeout(timer); controller.abort(); };
  let timedOut = false;
  const timer = setTimeout(() => {
    if (!controller.signal.aborted) { timedOut = true; abort(); }
  }, options.config.timeoutMs);
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const observedAt = new Date().toISOString();
  try {
    if (controller.signal.aborted) throw new ObservationFailure('cancelled');
    const source = await request(options, controller.signal);
    if (!record(source)) throw new ObservationFailure('invalid_json');
    return Object.freeze({ observedAt, phase, status: 'ready', reason: null, values: values(source) });
  } catch (error) {
    if (error instanceof ObservationCleanupFailure) throw error;
    return Object.freeze({ observedAt, phase, status: 'unavailable',
      reason: failureReason(error, controller.signal, timedOut), values: values(undefined) });
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}
