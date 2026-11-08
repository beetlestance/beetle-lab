import { measureStartedMetric, metricSeriesKey } from '../plan/index.js';
import { isK6MetricProfile } from './profile.js';
import type { K6MetricProfile } from './profile.js';
import { MetricAccumulatorError, seriesSnapshot } from './snapshot.js';
import type { AccumulatorCode, MetricSnapshot, MetricWindow, SeriesTotal } from './snapshot.js';
import { accumulate, checkedSum } from './totals.js';
import { Windows } from './windows.js';
import type { MetricPoint } from './types.js';

export interface MetricAccumulatorOptions {
  readonly profile: K6MetricProfile;
  readonly window: (window: MetricWindow, signal: AbortSignal) => Promise<void>;
}
export class MetricAccumulator {
  private readonly profile: K6MetricProfile;
  private readonly sink: MetricAccumulatorOptions['window'];
  private readonly totals = new Map<string, SeriesTotal>();
  private readonly windows: Windows;
  private flight: Promise<unknown> | undefined;
  private closePromise: Promise<void> | undefined;
  private closed = false;
  private poisoned: AccumulatorCode | undefined;
  private markerTime: number | undefined;
  private firstExecuteTime = Infinity;
  private markerDelayDroppedBuckets = 0;
  private readonly allowed: ReadonlySet<string>;
  constructor(options: MetricAccumulatorOptions) {
    if (!isK6MetricProfile(options.profile) || typeof options.window !== 'function') throw new MetricAccumulatorError('invalid_profile');
    this.profile = options.profile; this.sink = options.window;
    this.allowed = new Set(this.profile.allowedSeries.map(item => metricSeriesKey(item.metric, item.tags)));
    this.windows = new Windows(this.profile.maximumSeries);
  }
  private permitted(signal?: AbortSignal): void {
    if (this.poisoned) throw new MetricAccumulatorError(this.poisoned);
    if (this.closed) throw new MetricAccumulatorError('closed');
    if (signal?.aborted) throw new MetricAccumulatorError('cancelled');
  }
  private issue<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    if (this.flight) return Promise.reject(new MetricAccumulatorError('busy'));
    try { this.permitted(signal); }
    catch (error) {
      if (error instanceof MetricAccumulatorError && error.code === 'cancelled') this.poisoned ??= error.code;
      return Promise.reject(error);
    }
    const pending = Promise.resolve().then(async () => { this.permitted(signal); return work(); });
    const flight = pending.catch((error: unknown) => {
      const code = error instanceof MetricAccumulatorError ? error.code : 'invalid_point';
      this.poisoned ??= code; throw new MetricAccumulatorError(code);
    }).finally(() => { this.flight = undefined; });
    this.flight = flight;
    return flight;
  }
  point(point: MetricPoint, signal: AbortSignal): Promise<void> {
    // The decoder owns point admission; copy the numeric projection before yielding.
    const input = { ...point, tags: Object.freeze({ ...point.tags }) };
    return this.issue(signal, async () => {
      this.validate(input);
      if (input.metric === measureStartedMetric) { this.marker(input); return; }
      if (input.tags.phase === 'prepare') return;
      accumulate(this.totals, input, this.profile.maximumSeries);
      if (!this.windowEligible(input)) return;
      const cutoff = this.windows.advance(input.timeMs);
      if (this.markerTime === undefined) {
        while (this.windows.takeBefore(cutoff)) this.markerDelayDroppedBuckets = checkedSum(this.markerDelayDroppedBuckets, 1, true);
      } else await this.drain(cutoff, signal);
      this.permitted(signal); this.windows.add(input);
    });
  }
  private windowEligible(input: MetricPoint): boolean {
    if (input.tags.phase === 'execute' || input.metric === 'dropped_iterations') {
      this.firstExecuteTime = Math.min(this.firstExecuteTime, input.timeMs);
      if (this.markerTime !== undefined && input.timeMs < this.markerTime) throw new MetricAccumulatorError('measurement');
      return true;
    }
    return this.markerTime !== undefined && input.timeMs >= this.markerTime;
  }
  private validate(point: MetricPoint): void {
    this.validateMarker(point);
    const definition = this.profile.metrics.find(metric => metric.name === point.metric);
    if (!definition || definition.kind !== point.kind) throw new MetricAccumulatorError('invalid_point');
    this.validateNumber(point); this.validateTags(point);
  }
  private validateMarker(point: MetricPoint): void {
    if (point.metric === measureStartedMetric && (point.kind !== 'counter' || point.value !== 1
      || Object.keys(point.tags).length !== 0)) throw new MetricAccumulatorError('measurement');
  }
  private validateNumber(point: MetricPoint): void {
    if (!Number.isFinite(point.value) || point.value < 0
      || !Number.isSafeInteger(point.timeMs) || point.timeMs < 0) throw new MetricAccumulatorError('invalid_point');
    if (point.kind === 'counter' && !Number.isSafeInteger(point.value)) throw new MetricAccumulatorError('invalid_point');
    if (point.kind === 'rate' && point.value !== 0 && point.value !== 1) throw new MetricAccumulatorError('invalid_point');
  }
  private validateTags(point: MetricPoint): void {
    if (!this.allowed.has(metricSeriesKey(point.metric, point.tags))
      || Object.entries(point.tags).some(([key, value]) => !['phase', 'request', 'assertion'].includes(key) || typeof value !== 'string')) {
      throw new MetricAccumulatorError('invalid_point');
    }
  }
  private marker(point: MetricPoint): void {
    if (this.markerTime !== undefined || this.firstExecuteTime < point.timeMs) throw new MetricAccumulatorError('measurement');
    this.markerTime = point.timeMs;
  }
  private async drain(cutoff: number, signal: AbortSignal): Promise<void> {
    let window: MetricWindow | undefined;
    while ((window = this.windows.takeBefore(cutoff))) {
      this.permitted(signal);
      try { await this.sink(window, signal); }
      catch { this.permitted(signal); throw new MetricAccumulatorError('sink_failed'); }
      this.permitted(signal);
    }
  }
  finish(signal: AbortSignal): Promise<MetricSnapshot> {
    return this.issue(signal, async () => {
      if (this.markerTime === undefined) throw new MetricAccumulatorError('measurement');
      await this.drain(Infinity, signal); this.permitted(signal);
      const result: MetricSnapshot = Object.freeze({ totals: seriesSnapshot(this.totals), totalsComplete: true,
        measurement: Object.freeze({ complete: true, sourceTimeMs: this.markerTime }),
        windowCoverage: Object.freeze({ complete: this.windows.latePoints === 0 && this.markerDelayDroppedBuckets === 0,
          latePoints: this.windows.latePoints, markerDelayDroppedBuckets: this.markerDelayDroppedBuckets }),
        quantiles: 'unknown' });
      this.closed = true; return result;
    });
  }
  /** Preserve the issued promise outcome; a stuck sink keeps close outstanding. */
  close(): Promise<void> {
    this.closed = true;
    this.closePromise ??= (this.flight ?? Promise.resolve()).then(() => undefined);
    return this.closePromise;
  }
}
