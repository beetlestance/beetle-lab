import { captureLiveMetricSnapshot, captureLiveMetricSubset, liveMetricSubsetText } from '@beetle/contracts/api';
import { LiveMetricPublisherError, type LiveMetricPublisherOptions } from './types.js';

export function captureOptions(options: LiveMetricPublisherOptions) {
  try {
    validateBudget(options);
    if (options.signal !== undefined && !(options.signal instanceof AbortSignal)) throw new Error();
    const timeoutMs = options.timeoutMs; const maximumProducedBytes = options.maximumProducedBytes;
    const subset = captureLiveMetricSubset(options.subset); const hash = options.hash;
    const subsetDigest = hash(liveMetricSubsetText(subset));
    const frame = captureLiveMetricSnapshot({version: 1, scope: options.scope, producerEpoch: options.producerEpoch,
      subset, subsetDigest, sourceSequence: 1, publishedSequence: 1, coalescedWindows: 0,
      capturedAtMs: 0, publishedAtMs: 0, startTimeMs: 0, endTimeMs: 1000, upstreamCoverage: 'unknown', series: []}, hash);
    const sink = {write: options.sink.write.bind(options.sink), close: options.sink.close.bind(options.sink)};
    const clock = options.clock ? {wall: options.clock.wall.bind(options.clock), monotonic: options.clock.monotonic.bind(options.clock)}
      : {wall: () => Date.now(), monotonic: () => performance.now()};
    const initial = {wall: clock.wall(), monotonic: clock.monotonic()};
    if (!validClock(initial)) throw new Error();
    return {frame, hash, sink, clock, initial, timeoutMs, maximumProducedBytes, signal: options.signal};
  } catch {throw new LiveMetricPublisherError('invalid_options');}
}
function validateBudget(options: LiveMetricPublisherOptions): void {
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 172800000) throw new Error();
  if (!Number.isInteger(options.maximumProducedBytes) || options.maximumProducedBytes < 1 || options.maximumProducedBytes > 4294967296) throw new Error();
}
export function validClock(value: {wall: number; monotonic: number}): boolean {
  return Number.isInteger(value.wall) && value.wall >= 0 && value.wall <= 8640000000000000
    && Number.isFinite(value.monotonic) && value.monotonic >= 0 && value.monotonic <= Number.MAX_SAFE_INTEGER;
}
export type CapturedOptions = ReturnType<typeof captureOptions>;
