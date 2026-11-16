import { performance } from 'node:perf_hooks';
import type { RuntimeObservation } from '../admission/index.js';
import { acknowledgement, capture, snapshot, unknownObservation, validWall } from './publisher-input.js';
import type { Captured } from './publisher-input.js';
import { PublisherError } from './publisher-types.js';
import { publication } from './publication.js';
import type { ObservationPublisher, PublishedObservation, PublisherOptions, PublisherStatus } from './publisher-types.js';

const owners = new WeakSet<object>();
interface Sample { promise: Promise<void>; abort: AbortController; epoch: number; start: number; wall: number; expired: boolean }
interface Frame { observation: RuntimeObservation; epoch: number; start: number; wall: number }

class Publisher implements ObservationPublisher {
  readonly initial: Promise<{ readonly ready: boolean }>;
  private resolveInitial!: (value: { ready: boolean }) => void;
  private running = false;
  private closed = false;
  private failed = false;
  private ready = false;
  private polling = false;
  private invalid = false;
  private guards = false;
  private epoch = 0;
  private wallHigh = 0;
  private monoHigh = 0;
  private submitted = -1;
  private lastKnownAt: number | null = null;
  private knownStart: number | null = null;
  private publishedFrame: PublishedObservation | null = null;
  private sample: Sample | undefined;
  private write: Promise<void> | undefined;
  private publishingFrame: Frame | undefined;
  private pending: Frame | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private closing: Promise<void> | undefined;

  constructor(private readonly ports: Captured) {
    if (owners.has(ports.journal)) throw new PublisherError('busy');
    owners.add(ports.journal);
    this.initial = new Promise(resolve => { this.resolveInitial = resolve; });
  }
  start(): void {
    if (this.closed) throw new PublisherError('closed');
    if (this.running || this.failed) return;
    this.running = true;
    this.timer = setInterval(() => this.poll(), this.ports.interval);
    this.poll();
  }
  status(): PublisherStatus {
    const reentrant = this.polling;
    this.poll(false);
    return { ready: this.ready && !reentrant, running: this.running, closed: this.closed, failed: this.failed,
      sampling: this.sample !== undefined, publishing: this.write !== undefined, lastKnownAt: this.lastKnownAt };
  }
  snapshot(): PublishedObservation | null {
    return this.status().ready ? this.publishedFrame : null;
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true; this.running = false; this.ready = false; this.publishedFrame = null; this.epoch++;
    clearInterval(this.timer); this.pending = undefined; this.resolveInitial({ ready: false });
    const sample = this.sample; const write = this.write;
    this.closing = Promise.resolve().then(async () => {
      await Promise.all([sample?.promise, write]);
      if (this.failed) throw new PublisherError('cleanup');
      const observation = unknownObservation(this.wallTime());
      this.submitted = Math.max(this.submitted, observation.observedAt);
      try { acknowledgement(await this.ports.admission({ kind: 'observe', observation })); }
      catch { this.fail(); throw new PublisherError('cleanup'); }
      owners.delete(this.ports.journal);
    });
    sample?.abort.abort();
    return this.closing;
  }
  private wallTime(): number {
    try {
      const value = this.ports.wall();
      if (!validWall(value) || value < this.wallHigh) throw new Error();
      this.wallHigh = value; return value;
    } catch { return this.wallHigh; }
  }
  private clocks(): { mono: number; wall: number } | undefined {
    try {
      const mono = this.ports.mono();
      if (this.closed || !Number.isFinite(mono) || mono < this.monoHigh || mono < 0) return undefined;
      this.monoHigh = mono;
      const wall = this.ports.wall();
      if (this.closed || !validWall(wall) || wall < this.wallHigh) return undefined;
      this.wallHigh = wall; return { mono, wall };
    } catch { return undefined; }
  }
  private guardStatus(): boolean {
    try {
      const output = this.ports.output();
      if (this.closed) return false;
      const timeout = this.ports.timeout();
      if (this.closed) return false;
      return output.ready === true && output.running === true && output.closed === false
        && timeout.ready === true && timeout.running === true && timeout.closed === false;
    } catch { return false; }
  }
  private poll(issue = true): void {
    if (!this.running || this.closed || this.failed || this.polling) return;
    this.polling = true;
    try { this.inspect(issue); }
    finally { this.polling = false; }
  }
  private inspect(issue: boolean): void {
    const time = this.availability();
    if (!time || this.stopped()) return;
    this.expiry(time.mono);
    if (!issue || this.sample || this.closed) return;
    this.beginSample(time);
  }
  private stopped(): boolean { return this.closed || this.failed; }
  private availability(): { mono: number; wall: number } | undefined {
    const time = this.clocks();
    if (this.closed) return undefined;
    const guards = this.guardStatus();
    if (this.closed) return undefined;
    const lost = this.guards && !guards; this.guards = guards;
    if (!time || !guards) { this.invalidate(lost || !time); return undefined; }
    return time;
  }
  private expiry(mono: number): void {
    if (this.sample && !this.sample.expired && mono - this.sample.start >= this.ports.deadline) {
      this.sample.expired = true; this.invalidate(true); this.sample.abort.abort();
    }
    const frame = this.publishingFrame;
    if (frame?.observation.status === 'known' && frame.epoch === this.epoch && mono - frame.start >= this.ports.ttl) {
      this.invalidate(true);
    }
    if (this.knownExpired(mono)) {
      this.knownStart = null; this.invalidate(true);
    }
  }
  private knownExpired(mono: number): boolean {
    return this.knownStart !== null && (mono - this.knownStart >= this.ports.ttl
      || this.publishedFrame !== null && this.wallHigh >= this.publishedFrame.expiresAtMs);
  }
  private invalidate(force = false): void {
    if (this.closed || this.failed) return;
    this.ready = false; this.publishedFrame = null; this.resolveInitial({ ready: false });
    if (this.invalid && !force) return;
    const revoke = !this.invalid;
    this.invalid = true; this.epoch++;
    if (!revoke) return;
    const wall = this.wallTime();
    this.enqueue({ observation: unknownObservation(wall), epoch: this.epoch, start: this.monoHigh, wall });
  }
  private beginSample(time: { mono: number; wall: number }): void {
    const sample: Sample = { promise: Promise.resolve(), abort: new AbortController(), epoch: this.epoch,
      start: time.mono, wall: time.wall, expired: false };
    sample.promise = Promise.resolve().then(async () => {
      if (this.closed || this.failed) return;
      try {
        const result = await this.ports.sample({ deadline: performance.now() + this.ports.deadline, signal: sample.abort.signal });
        this.completeSample(sample, result);
      } catch { if (!this.closed) this.invalidate(true); }
    }).finally(() => { if (this.sample === sample) this.sample = undefined; });
    this.sample = sample;
  }
  private completeSample(sample: Sample, result: RuntimeObservation): void {
    if (this.stopped()) return;
    const time = this.clocks();
    if (this.closed) return;
    const guards = this.guardStatus();
    if (this.closed) return;
    if (!time || !guards) { this.guards = guards; this.invalidate(true); return; }
    this.expiry(time.mono);
    if (!this.currentSample(sample)) return;
    let observation: RuntimeObservation;
    try { observation = snapshot(result); } catch { this.invalidate(true); return; }
    if (!this.freshSample(observation, sample, time)) { this.invalidate(true); return; }
    if (observation.observedAt <= this.submitted) return;
    observation.guards = { source: 'supervisor', observedAt: observation.observedAt, controls: ['timeout', 'output'] };
    this.enqueue({ observation, epoch: sample.epoch, start: sample.start, wall: sample.wall });
  }
  private currentSample(sample: Sample): boolean { return !sample.expired && sample.epoch === this.epoch; }
  private freshSample(observation: RuntimeObservation, sample: Sample, time: { mono: number; wall: number }): boolean {
    return observation.status === 'known' && validWall(observation.observedAt)
      && observation.observedAt >= sample.wall && observation.observedAt <= time.wall
      && time.mono - sample.start < this.ports.ttl;
  }
  private enqueue(frame: Frame): void {
    if (this.closed || this.failed) return;
    if (this.pending?.observation.status === 'unknown' && frame.observation.status === 'known') return;
    this.pending = frame;
    this.flush();
  }
  private flush(): void {
    if (this.closed || this.failed || this.write || !this.pending) return;
    const frame = this.pending; this.pending = undefined; this.publishingFrame = frame;
    this.write = Promise.resolve().then(() => this.publish(frame)).finally(() => {
      this.write = undefined; this.publishingFrame = undefined;
      this.flush();
    });
  }
  private async publish(frame: Frame): Promise<void> {
    if (this.closed || this.failed) return;
    if (frame.observation.status === 'known' && !this.eligible(frame)) return;
    if (this.closed || this.failed) return;
    this.submitted = Math.max(this.submitted, frame.observation.observedAt);
    if (frame.observation.status === 'known') this.invalid = false;
    try {
      const view = frame.observation.status === 'known' ? publication(frame.observation, frame.wall, this.ports.ttl) : null;
      const stored = acknowledgement(await this.ports.admission({ kind: 'observe', observation: frame.observation }));
      this.committed(frame, stored, view);
    } catch { this.fail(); }
  }
  private committed(frame: Frame, stored: boolean, view: PublishedObservation | null): void {
    if (this.closed || this.failed || frame.observation.status !== 'known') return;
    if (!this.eligible(frame)) return;
    if (stored && !view) { this.fail(); return; }
    this.invalid = !stored; this.ready = stored;
    this.publishedFrame = stored ? view : null;
    if (stored) { this.knownStart = frame.start; this.lastKnownAt = frame.observation.observedAt; this.resolveInitial({ ready: true }); }
    else this.resolveInitial({ ready: false });
  }
  private eligible(frame: Frame): boolean {
    const time = this.clocks();
    if (this.closed) return false;
    const guards = this.guardStatus();
    if (this.closed) return false;
    if (!time || !guards || time.mono - frame.start >= this.ports.ttl || time.wall - frame.wall >= this.ports.ttl) {
      this.guards = guards; this.invalidate(true); return false;
    }
    return frame.epoch === this.epoch;
  }
  private fail(): void {
    this.failed = true; this.ready = false; this.publishedFrame = null; this.running = false;
    this.pending = undefined; clearInterval(this.timer); this.resolveInitial({ ready: false });
    this.sample?.abort.abort();
  }
}
export function createObservationPublisher(options: PublisherOptions): ObservationPublisher {
  return new Publisher(capture(options));
}
