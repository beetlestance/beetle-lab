import { captureLiveMetricSnapshot, encodeLiveMetricSnapshot, type LiveMetricSnapshot } from '@beetle/contracts/api';
import type { MetricWindow } from '@beetle/contracts/metrics';
import { validClock, type CapturedOptions } from './options.js';
import { projectWindow } from './project.js';
import type { LiveMetricPublisher, LiveMetricPublisherState, LiveMetricFailure, LiveMetricCloseResult } from './types.js';

export class Publisher implements LiveMetricPublisher {
  private readonly facts: LiveMetricPublisherState = {status: 'open', reason: null, sourceSequence: 0, publishedSequence: 0,
    coalescedWindows: 0, discardedOnStop: 0, pending: false, writing: false, chargedBytes: 0};
  private values = {...this.facts};
  private pending: LiveMetricSnapshot | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private deadline: ReturnType<typeof setTimeout> | undefined;
  private original: Promise<void> | undefined;
  private closing: Promise<LiveMetricCloseResult> | undefined;
  private readonly controller = new AbortController();
  private lastClock: {wall: number; monotonic: number};
  private lastEnd = -1;
  private lastIssued: number | undefined;
  private issued = 0;
  private readonly abort = () => {void this.stop();};

  constructor(private readonly options: CapturedOptions) {
    this.lastClock = options.initial;
    this.deadline = setTimeout(() => this.fail('deadline'), options.timeoutMs);
    options.signal?.addEventListener('abort', this.abort, {once: true});
    if (options.signal?.aborted) void this.stop();
  }
  state(): Readonly<LiveMetricPublisherState> {return Object.freeze({...this.values});}
  accept(window: MetricWindow): boolean {
    if (this.values.status !== 'open') return false;
    const clock = this.readClock(); if (!clock) return false;
    try {
      if (this.values.sourceSequence >= 65536 || window.startTimeMs < this.lastEnd) throw new Error();
      const projected = projectWindow(window, this.options.frame.subset);
      const sourceSequence = this.values.sourceSequence + 1;
      const coalescedWindows = this.values.coalescedWindows + (this.pending ? 1 : 0);
      // Issuance stays stable across success/cleanup microtasks for the current original.
      const publishedSequence = this.issued + 1;
      this.pending = captureLiveMetricSnapshot({...this.options.frame, ...projected, sourceSequence,
        publishedSequence, coalescedWindows, capturedAtMs: clock.wall, publishedAtMs: clock.wall}, this.options.hash);
      this.lastEnd = window.endTimeMs;
      this.values = {...this.values, sourceSequence, coalescedWindows, pending: true};
      this.schedule(clock.monotonic); return true;
    } catch {this.fail('invalid_input'); return false;}
  }
  private readClock() {
    try {
      const next = {wall: this.options.clock.wall(), monotonic: this.options.clock.monotonic()};
      if (!validClock(next) || next.wall < this.lastClock.wall || next.monotonic < this.lastClock.monotonic) throw new Error();
      this.lastClock = next;
      if (next.monotonic - this.options.initial.monotonic >= this.options.timeoutMs) {this.fail('deadline'); return;}
      return next;
    } catch {this.fail('clock'); return;}
  }
  private schedule(monotonic: number): void {
    if (this.values.status !== 'open' || this.original || this.timer !== undefined || !this.pending) return;
    const wait = this.lastIssued === undefined ? 0 : Math.max(0, 2000 - (monotonic - this.lastIssued));
    this.timer = setTimeout(() => {this.timer = undefined; this.publish();}, wait);
  }
  private publish(): void {
    if (this.values.status !== 'open' || this.original || !this.pending) return;
    const clock = this.readClock(); if (!clock) return;
    if (this.lastIssued !== undefined && clock.monotonic - this.lastIssued < 2000) {this.schedule(clock.monotonic); return;}
    let bytes: Uint8Array;
    try {bytes = encodeLiveMetricSnapshot({...this.pending, publishedAtMs: clock.wall}, this.options.hash);}
    catch {this.fail('invalid_input'); return;}
    if (this.issued >= Math.min(65536, 1 + Math.floor(this.options.timeoutMs / 2000))
      || bytes.length > this.options.maximumProducedBytes - this.values.chargedBytes) {this.fail('quota'); return;}
    const sequence = this.pending.publishedSequence; this.pending = undefined; this.issued++; this.lastIssued = clock.monotonic;
    this.values = {...this.values, writing: true, pending: false, chargedBytes: this.values.chargedBytes + bytes.length};
    const original = Promise.resolve().then(() => this.options.sink.write(bytes, this.controller.signal))
      .then(() => {this.values = {...this.values, publishedSequence: sequence};}, () => this.fail('sink'))
      .finally(() => {
        this.original = undefined; this.values = {...this.values, writing: false};
        if (this.values.status === 'open') {const current = this.readClock(); if (current) this.schedule(current.monotonic);}
      });
    this.original = original;
  }
  private fail(reason: LiveMetricFailure): void {
    this.values = {...this.values, status: 'failed', reason: this.values.reason ?? reason};
    this.clearTimers(); this.controller.abort();
  }
  private clearTimers(): void {
    clearTimeout(this.timer); clearTimeout(this.deadline); this.timer = undefined; this.deadline = undefined;
  }
  stop(): Promise<LiveMetricCloseResult> {
    if (this.closing) return this.closing;
    const original = this.original;
    this.closing = Promise.resolve().then(() => this.finish(original));
    this.values = {...this.values, status: this.values.reason ? 'failed' : 'stopping', pending: false, discardedOnStop: this.pending ? 1 : 0};
    this.pending = undefined; this.clearTimers(); this.options.signal?.removeEventListener('abort', this.abort); this.controller.abort();
    return this.closing;
  }
  close(): Promise<LiveMetricCloseResult> {return this.stop();}
  private async finish(original: Promise<void> | undefined): Promise<LiveMetricCloseResult> {
    await original;
    try {
      await this.options.sink.close();
      this.values = {...this.values, status: this.values.reason ? 'failed' : 'closed'};
      return Object.freeze({quiescence: 'confirmed', state: this.state()});
    } catch {
      this.fail('cleanup'); return Object.freeze({quiescence: 'failed', state: this.state()});
    }
  }
}
