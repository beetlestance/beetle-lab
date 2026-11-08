import { performance } from 'node:perf_hooks';
import { PublicationError } from './types.js';
import type { PublicationCode } from './types.js';
import type { Profile } from './profile.js';

/** A publication timer fences waiting; it cannot cancel an issued kernel operation. */
export class Budget {
  private highWater = -1;
  private monoDeadline = Infinity;
  private reason: PublicationError | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private reject!: (reason: PublicationError) => void;
  private readonly fence = new Promise<never>((_, reject) => { this.reject = reject; });
  private readonly abort = () => this.stop('cancelled');
  constructor(private readonly profile: Profile) { void this.fence.catch(() => undefined); }
  start(): void {
    const now = this.check();
    this.monoDeadline = performance.now() + Math.min(this.profile.timeoutMs, this.profile.deadlineMs - now);
    this.profile.signal?.addEventListener('abort', this.abort, { once: true });
    this.tick();
  }
  private active(): void {
    if (this.profile.signal?.aborted) this.stop('cancelled');
    if (this.reason) throw this.reason;
  }
  check(): number {
    this.active();
    let now: number;
    try { now = this.profile.wallNow(); }
    catch { this.stop('clock'); throw this.reason; }
    this.active();
    if (!Number.isSafeInteger(now) || now < 0 || now < this.highWater || now > 8_640_000_000_000_000) this.stop('clock');
    this.highWater = now;
    if (now >= this.profile.deadlineMs || performance.now() >= this.monoDeadline) this.stop('deadline');
    this.active(); return now;
  }
  stop(code: PublicationCode): void {
    if (code === 'cancelled' || !this.reason) this.reason = new PublicationError(code);
    this.reject(this.reason!); clearTimeout(this.timer);
  }
  race<T>(work: Promise<T>): Promise<T> { return Promise.race([work, this.fence]); }
  private tick(): void {
    try { this.check(); } catch { return; }
    this.timer = setTimeout(() => this.tick(), 10); this.timer.unref();
  }
  dispose(): void { clearTimeout(this.timer); this.profile.signal?.removeEventListener('abort', this.abort); }
}
