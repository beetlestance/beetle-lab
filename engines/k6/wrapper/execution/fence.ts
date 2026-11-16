import { ExecutionError } from './types.js';
import type { ExecutionCode } from './types.js';
import type { AcceptedOptions } from './profile.js';

/** One cross-phase authority. A fence settles publication; it does not preempt issued work. */
export class Fence {
  readonly controller = new AbortController();
  private reason: ExecutionError | undefined;
  private wall = -1;
  private mono = -1;
  private monoEnd = Infinity;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private reject!: (error: ExecutionError) => void;
  private readonly stopped = new Promise<never>((_, reject) => { this.reject = reject; });
  private readonly cancel = () => this.stop('cancelled');
  constructor(private readonly input: AcceptedOptions) { void this.stopped.catch(() => undefined); }
  start(): void {
    this.input.signal?.addEventListener('abort', this.cancel, { once: true });
    const sample = this.check();
    this.monoEnd = sample.mono + Math.min(this.input.compiled.attempt.timeoutMs,
      this.input.compiled.attempt.deadlineMs - sample.wall);
    this.check(); this.tick();
  }
  private active(): void {
    if (this.input.signal?.aborted) this.stop('cancelled');
    if (this.reason) throw this.reason;
  }
  private sample(terminal = false): { wall: number; mono: number } {
    try {
      const wall = this.input.clock.wall(); if (!terminal) this.active();
      const mono = this.input.clock.monotonic(); if (!terminal) this.active();
      return { wall, mono };
    }
    catch { this.stop('clock'); throw this.reason; }
  }
  private valid(sample: { wall: number; mono: number }): boolean {
    return Number.isSafeInteger(sample.wall) && sample.wall >= 0 && sample.wall <= 8_640_000_000_000_000
      && Number.isFinite(sample.mono) && sample.mono >= 0 && sample.wall >= this.wall && sample.mono >= this.mono;
  }
  private record(sample: { wall: number; mono: number }): void {
    if (!this.valid(sample)) { this.stop('clock'); throw this.reason; }
    this.wall = sample.wall; this.mono = sample.mono;
  }
  check(): { wall: number; mono: number } {
    this.active(); const sample = this.sample(); this.active(); this.record(sample);
    if (sample.wall < this.input.compiled.attempt.deadlineMs - this.input.compiled.attempt.timeoutMs) this.stop('clock');
    if (sample.wall >= this.input.compiled.attempt.deadlineMs || sample.mono >= this.monoEnd) this.stop('deadline');
    this.active(); return sample;
  }
  /** Observation only: cancellation does not make an otherwise valid terminal clock fictitious. */
  terminalTime(): string | null {
    try {
      if (this.reason?.code === 'clock') return null;
      const sample = this.sample(true); this.record(sample);
      if (sample.wall < this.input.compiled.attempt.deadlineMs - this.input.compiled.attempt.timeoutMs) return null;
      return new Date(sample.wall).toISOString();
    } catch { return null; }
  }
  stop(code: ExecutionCode): void {
    this.reason ??= new ExecutionError(code);
    this.reject(this.reason); clearTimeout(this.timer);
    this.controller.abort();
  }
  race<T>(work: Promise<T>): Promise<T> { return Promise.race([work, this.stopped]); }
  private tick(): void {
    try { this.check(); } catch { return; }
    this.timer = setTimeout(() => this.tick(), 25); this.timer.unref();
  }
  dispose(): void { clearTimeout(this.timer); this.input.signal?.removeEventListener('abort', this.cancel); }
}
