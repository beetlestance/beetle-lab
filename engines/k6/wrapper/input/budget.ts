import { performance } from 'node:perf_hooks';
import { validateAttempt } from '../../runtime/index.js';
import { InputError } from './types.js';
import type { OpenStagedOptions, StagedHeaders } from './types.js';

const maximumDate = 8_640_000_000_000_000;
/** Wall high-water fence plus independent monotonic ceilings; no execution clock reset. */
export class Budget {
  private highWater = -1;
  private wallDeadline = maximumDate;
  private monoDeadline = Infinity;
  private headerDeadline = Infinity;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private reason: InputError | undefined;
  private rejectFence!: (error: InputError) => void;
  private readonly fence = new Promise<never>((_resolve, reject) => { this.rejectFence = reject; });
  private readonly pending = new Set<Promise<unknown>>();
  private readonly abort = () => this.stop('cancelled');
  constructor(private readonly options: OpenStagedOptions) { void this.fence.catch(() => undefined); }
  start(): void {
    const timeout = this.options.headerTimeoutMs;
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 60_000) throw new InputError('binding');
    this.check(); this.headerDeadline = performance.now() + timeout;
    this.options.signal.addEventListener('abort', this.abort, { once: true });
    if (this.options.signal.aborted) this.abort();
    this.tick();
  }
  bind(timeoutMs: number, deadlineMs: number): StagedHeaders['attempt'] {
    let attempt;
    try { attempt = validateAttempt({ mode: 'managed', timeoutMs, deadlineMs }); }
    catch { throw new InputError('binding'); }
    const admittedAt = deadlineMs - timeoutMs;
    if (attempt.mode !== 'managed' || deadlineMs > maximumDate || !Number.isSafeInteger(admittedAt) || admittedAt < 0) throw new InputError('binding');
    const now = this.check();
    if (now < admittedAt) throw new InputError('clock_fenced');
    this.wallDeadline = Math.min(this.wallDeadline, deadlineMs);
    this.monoDeadline = Math.min(this.monoDeadline, performance.now() + (deadlineMs - now));
    this.check();
    return Object.freeze(attempt);
  }
  metadata(deadlineMs: number): void {
    if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > maximumDate) throw new InputError('binding');
    const now = this.check();
    this.wallDeadline = deadlineMs;
    this.monoDeadline = performance.now() + (deadlineMs - now);
    this.check();
  }
  headersFinished(): void { this.check(); this.headerDeadline = Infinity; }
  check(): number {
    if (this.reason) throw this.reason;
    if (this.options.signal.aborted) this.stop('cancelled');
    const now = this.now();
    if (!Number.isSafeInteger(now) || now < 0 || now > maximumDate || now < this.highWater) this.stop('clock_fenced');
    this.highWater = now;
    if (now >= this.wallDeadline || performance.now() >= Math.min(this.headerDeadline, this.monoDeadline)) this.stop('deadline');
    if (this.reason) throw this.reason;
    return now;
  }
  private now(): number {
    try { return (this.options.wallNow ?? Date.now)(); }
    catch { this.stop('clock_fenced'); throw this.reason; }
  }
  private tick(): void {
    try { this.check(); }
    catch { return; }
    this.timer = setTimeout(() => this.tick(), Math.max(1, Math.min(25, this.headerDeadline - performance.now(), this.monoDeadline - performance.now())));
    this.timer.unref();
  }
  stop(code: 'cancelled' | 'deadline' | 'clock_fenced' | 'closed'): void {
    this.reason ??= new InputError(code);
    this.rejectFence(this.reason);
    if (this.timer) clearTimeout(this.timer);
  }
  race<T>(work: Promise<T>): Promise<T> { return Promise.race([work, this.fence]); }
  async wait<T>(issue: () => Promise<T>): Promise<T> {
    this.check();
    // Adopt the promise before invoking an injected callback or issuing IO.
    const raw = Promise.resolve().then(() => { this.check(); return issue(); });
    this.pending.add(raw);
    void raw.then(() => this.pending.delete(raw), () => this.pending.delete(raw));
    const value = await this.race(raw); this.check(); return value;
  }
  async settled(): Promise<void> { await Promise.allSettled([...this.pending]); }
  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.options.signal.removeEventListener('abort', this.abort);
  }
}
