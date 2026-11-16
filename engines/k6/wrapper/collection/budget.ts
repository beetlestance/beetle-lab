import { performance } from 'node:perf_hooks';
import { SummaryError } from './types.js';
import type { SummaryCode, SummaryOptions } from './types.js';

export class Budget {
  private highWater = -1;
  private monoDeadline = Infinity;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private reason: SummaryError | undefined;
  private reject!: (error: SummaryError) => void;
  private readonly fence = new Promise<never>((_, reject) => { this.reject = reject; });
  private readonly abort = () => this.stop('cancelled');
  constructor(private readonly options: SummaryOptions) { void this.fence.catch(() => undefined); }
  start(): void {
    if (!Number.isSafeInteger(this.options.timeoutMs) || this.options.timeoutMs < 1 || this.options.timeoutMs > 30_000
      || !Number.isSafeInteger(this.options.deadlineMs) || this.options.deadlineMs < 1
      || this.options.deadlineMs > 8_640_000_000_000_000) throw new SummaryError('profile');
    const now = this.check();
    this.monoDeadline = performance.now() + Math.min(this.options.timeoutMs, this.options.deadlineMs - now);
    this.options.signal?.addEventListener('abort', this.abort, { once: true });
    this.tick();
  }
  check(): number {
    if (this.options.signal?.aborted) this.stop('cancelled');
    if (this.reason) throw this.reason;
    let now: number;
    try { now = (this.options.wallNow ?? Date.now)(); }
    catch { this.stop('clock'); throw this.reason; }
    // The external clock may reenter close().
    this.assertActive();
    this.validateClock(now);
    this.highWater = now;
    if (now >= this.options.deadlineMs || performance.now() >= this.monoDeadline) this.stop('deadline');
    if (this.reason) throw this.reason;
    return now;
  }
  private assertActive(): void {
    if (this.options.signal?.aborted) this.stop('cancelled');
    if (this.reason) throw this.reason;
  }
  private validateClock(now: number): void {
    if (!Number.isSafeInteger(now) || now < 0 || now < this.highWater || now > 8_640_000_000_000_000) this.stop('clock');
  }
  stop(code: SummaryCode): void {
    if (code === 'cancelled' || !this.reason) this.reason = new SummaryError(code);
    this.reject(this.reason!);
    if (this.timer) clearTimeout(this.timer);
  }
  race<T>(work: Promise<T>): Promise<T> { return Promise.race([work, this.fence]); }
  private tick(): void {
    try { this.check(); } catch { return; }
    this.timer = setTimeout(() => this.tick(), 10); this.timer.unref();
  }
  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.options.signal?.removeEventListener('abort', this.abort);
  }
}
