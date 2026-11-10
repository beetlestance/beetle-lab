export { DurationHistogram, mergeDistributions } from './distribution.js';
export { distributionPercentile } from './percentile.js';
export { DistributionError } from './distribution-types.js';
export type { DurationDistribution, DurationPercentile, PercentileEstimate } from './distribution-types.js';
import { Records } from './record.js';
import { MetricStreamError } from './types.js';
import type { MetricStreamCode, MetricStreamOptions } from './types.js';
export { MetricStreamError } from './types.js';
export type { MetricDefinition, MetricKind, MetricPoint, MetricStreamOptions } from './types.js';
export { createK6MetricProfile } from './profile.js';
export type { K6MetricProfile } from './profile.js';
export { MetricAccumulator } from './accumulator.js';
export type { MetricAccumulatorOptions } from './accumulator.js';
export { MetricAccumulatorError } from './snapshot.js';
export type { AccumulatorCode, NumericTotal, SeriesTotal, MetricWindow, MetricSnapshot } from './snapshot.js';
const lineBytes = 65_536;
const chunkBytes = 1_048_576;
const intrinsicByteLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype) as object, 'byteLength')!.get!;
function positive(value: number): boolean { return Number.isSafeInteger(value) && value >= 1; }
function snapshot(input: Uint8Array, remaining: number): Uint8Array {
  if (!(input instanceof Uint8Array)) throw new MetricStreamError('stream_limit');
  const size: unknown = intrinsicByteLength.call(input);
  if (typeof size !== 'number' || size > chunkBytes || size > remaining) throw new MetricStreamError('stream_limit');
  // TypedArray-to-TypedArray construction uses internal slots, not iteration or species.
  return new Uint8Array(input);
}

/** One bounded NDJSON frame and one snapshotted chunk; callback backpressure is
 * serialized. This decoder does not infer test outcomes or native completeness.
 */
export class MetricStream {
  private readonly records: Records;
  private readonly options: MetricStreamOptions;
  private readonly frame = new Uint8Array(lineBytes);
  private used = 0;
  private bytes = 0;
  private count = 0;
  private closed = false;
  private poisoned: MetricStreamCode | undefined;
  private flight: Promise<void> | undefined;
  private closePromise: Promise<void> | undefined;
  constructor(options: MetricStreamOptions) {
    if (!positive(options.maximumBytes) || !positive(options.maximumRecords) || typeof options.point !== 'function') {
      throw new MetricStreamError('invalid_profile');
    }
    this.options = Object.freeze({ ...options }); this.records = new Records(options);
  }
  private permitted(signal?: AbortSignal): void {
    if (this.poisoned) throw new MetricStreamError(this.poisoned);
    if (this.closed) throw new MetricStreamError('closed');
    if (signal?.aborted) throw new MetricStreamError('cancelled');
  }
  push(input: Uint8Array, signal: AbortSignal): Promise<void> {
    try {
      this.permitted();
      if (this.flight) throw new MetricStreamError('busy');
      this.permitted(signal);
      const chunk = snapshot(input, this.options.maximumBytes - this.bytes);
      this.bytes += chunk.byteLength;
      // Publish the flight before invoking any injected callback.
      const work = Promise.resolve().then(() => this.consume(chunk, signal));
      this.flight = work.then(() => undefined, error => {
        const code = error instanceof MetricStreamError ? error.code : 'sink_failed';
        this.poisoned ??= code; throw new MetricStreamError(code);
      }).finally(() => { this.flight = undefined; });
      return this.flight;
    } catch (error) {
      const failure = error instanceof MetricStreamError ? error : new MetricStreamError('invalid_record');
      if (failure.code !== 'busy') this.poisoned ??= failure.code;
      return Promise.reject(failure);
    }
  }
  private async consume(chunk: Uint8Array, signal: AbortSignal): Promise<void> {
    this.permitted(signal);
    let cursor = 0;
    while (cursor < chunk.byteLength) {
      this.permitted(signal);
      const found = chunk.indexOf(10, cursor);
      const end = found < 0 ? chunk.byteLength : found;
      const size = end - cursor;
      if (size > lineBytes - this.used) throw new MetricStreamError('line_limit');
      this.frame.set(chunk.subarray(cursor, end), this.used); this.used += size;
      cursor = end + 1;
      if (found >= 0) await this.record(signal);
    }
    this.permitted(signal);
  }
  private async record(signal: AbortSignal): Promise<void> {
    if (++this.count > this.options.maximumRecords) throw new MetricStreamError('record_limit');
    if (this.used === 0) throw new MetricStreamError('invalid_record');
    const point = this.records.read(this.frame.subarray(0, this.used));
    this.used = 0;
    if (point) {
      this.permitted(signal);
      try { await this.options.point(point, signal); }
      catch { throw new MetricStreamError(signal.aborted ? 'cancelled' : 'sink_failed'); }
      this.permitted(signal);
    }
  }
  /** Call only after native output closure; a partial final line is incomplete. */
  finish(): Readonly<{ bytes: number; records: number }> {
    this.permitted();
    if (this.flight) throw new MetricStreamError('busy');
    if (this.used) { this.poisoned = 'torn_record'; throw new MetricStreamError('torn_record'); }
    this.closed = true;
    return Object.freeze({ bytes: this.bytes, records: this.count });
  }
  /** A stalled issued sink remains outstanding; close does not invent quiescence. */
  close(): Promise<void> {
    this.closed = true;
    this.closePromise ??= (this.flight ?? Promise.resolve()).finally(() => { this.frame.fill(0); });
    return this.closePromise;
  }
}
