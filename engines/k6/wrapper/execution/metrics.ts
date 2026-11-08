import { measureStartedMetric } from '../../plan/index.js';
import { createK6MetricProfile, MetricAccumulator, MetricAccumulatorError, MetricStream, MetricStreamError } from '../../aggregation/index.js';
import type { MetricPoint, MetricSnapshot, MetricWindow } from '../../aggregation/index.js';
import type { Fence } from './fence.js';
import type { AcceptedOptions } from './profile.js';
import type { BuildUsage, MetricFailure } from './types.js';
import { ExecutionError } from './types.js';

/** Numeric composition only. Neither callbacks nor source records acquire outcome authority. */
export class Metrics {
  private readonly accumulator: MetricAccumulator;
  private readonly decoder: MetricStream;
  private failed: MetricFailure | null = null;
  private closing: Promise<void> | undefined;
  constructor(private readonly input: AcceptedOptions, private readonly fence: Fence, private readonly build: BuildUsage) {
    const profile = createK6MetricProfile(input.compiled.suite);
    this.accumulator = new MetricAccumulator({ profile, window: (window, signal) => this.window(window, signal) });
    this.decoder = new MetricStream({ ...profile, maximumBytes: input.limits.maximumMetricBytes,
      maximumRecords: input.limits.maximumMetricRecords, point: (point, signal) => this.point(point, signal) });
  }
  get failure(): MetricFailure | null { return this.failed; }
  private fail(failure: MetricFailure): void { this.failed ??= Object.freeze(failure); }
  private async window(window: MetricWindow, signal: AbortSignal): Promise<void> {
    this.fence.check();
    try { await this.input.window(window, signal); }
    catch (error) { this.fail({ source: 'callback', code: 'sink_failed' }); throw error; }
    this.fence.check();
  }
  private async point(point: MetricPoint, signal: AbortSignal): Promise<void> {
    this.fence.check();
    try { await this.accumulator.point(point, signal); }
    catch (error) {
      if (error instanceof MetricAccumulatorError) this.fail({ source: 'accumulator', code: error.code });
      throw error;
    }
    this.fence.check();
    if (point.metric !== measureStartedMetric) return;
    const receipt = Object.freeze({ sourceTimeMs: point.timeMs, observedAt: new Date(this.fence.check().wall).toISOString(), build: this.build });
    try { await this.input.measureStarted(receipt, signal); }
    catch (error) { this.fail({ source: 'callback', code: 'sink_failed' }); throw error; }
    this.fence.check();
  }
  async push(bytes: Readonly<Uint8Array>, signal: AbortSignal): Promise<void> {
    this.fence.check();
    try { await this.decoder.push(bytes, signal); }
    catch (error) {
      if (error instanceof MetricStreamError) this.fail({ source: 'decoder', code: error.code });
      throw error;
    }
    this.fence.check();
  }
  finishStream(): Readonly<{ bytes: number; records: number }> {
    this.fence.check();
    try { return this.decoder.finish(); }
    catch (error) {
      if (error instanceof MetricStreamError) this.fail({ source: 'decoder', code: error.code });
      throw error;
    }
  }
  verifyBytes(actual: number, admitted: number): void {
    if (actual === admitted) return;
    this.fail({ source: 'composition', code: 'byte_count' }); throw new ExecutionError('metrics');
  }
  async finish(): Promise<MetricSnapshot> {
    this.fence.check();
    try { const value = await this.accumulator.finish(this.fence.controller.signal); this.fence.check(); return value; }
    catch (error) {
      if (error instanceof MetricAccumulatorError) this.fail({ source: 'accumulator', code: error.code });
      throw error;
    }
  }
  close(): Promise<void> {
    this.closing ??= Promise.allSettled([this.decoder.close(), this.accumulator.close()]).then(results => {
      if (results.some(result => result.status === 'rejected')) throw new Error('Metric cleanup rejected');
    });
    return this.closing;
  }
}
