import { identity, optionsCopy, requestCopy } from './input.js';
import { Watch } from './watch.js';
import { TimeoutError } from './types.js';
import type { TimeoutGuard, TimeoutOptions, TimeoutRequest, TimeoutStatus, TimeoutWatch } from './types.js';

/** Independent deadline observation; lifecycle and durable stop effects belong to installation. */
export class TimeoutService implements TimeoutGuard {
  private readonly options: Required<TimeoutOptions>;
  private readonly watches = new Map<string, Watch>();
  private running = false;
  private closed = false;
  private failed = false;
  private reading = false;
  private accepting = false;
  private lastWall = 0;
  private lastMono = 0;
  private timer?: ReturnType<typeof setInterval>;
  private closing?: Promise<void>;
  constructor(options: TimeoutOptions) { this.options = optionsCopy(options); }
  start(): void {
    if (this.closed) throw new TimeoutError('closed');
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => this.check(), this.options.intervalMs);
    this.check();
  }
  watch(input: TimeoutRequest): TimeoutWatch {
    if (this.closed) throw new TimeoutError('closed');
    if (this.accepting) throw new TimeoutError('capacity');
    this.accepting = true;
    try { return this.register(input); } finally { this.accepting = false; }
  }
  private register(input: TimeoutRequest): Watch {
    const request = requestCopy(input);
    if (this.closed) throw new TimeoutError('closed');
    const id = identity(request.key);
    const existing = this.watches.get(id);
    if (existing) {
      if (existing.request.admittedAt !== request.admittedAt || existing.request.timeoutMs !== request.timeoutMs) {
        throw new TimeoutError('conflict');
      }
      this.refreshAnchor(existing, request);
      this.check(); return existing;
    }
    if (this.watches.size >= 64) throw new TimeoutError('capacity');
    const watch = new Watch(request, {
      check: () => this.check(), ready: () => this.running && !this.closed && !this.failed,
      stop: reason => this.options.stop(request.key, reason), retire: () => { this.watches.delete(id); },
    });
    // Own the registration before clocks may reenter close/status/watch.
    this.watches.set(id, watch);
    const now = this.sample();
    if (this.closed) { void watch.close().catch(() => undefined); return watch; }
    if (!now || !this.validAnchor(watch, now)) watch.stop('clock_integrity');
    else this.checkWatch(watch, now);
    return watch;
  }
  private validAnchor(watch: Watch, now: { wall: number; monotonic: number }): boolean {
    const request = watch.request;
    return !request.clockFenced && request.sampledAt <= now.monotonic && now.wall >= request.clockHighWater
      && Number.isSafeInteger(watch.absolute) && Number.isFinite(watch.deadline) && watch.deadline <= Number.MAX_SAFE_INTEGER;
  }
  private refreshAnchor(watch: Watch, request: TimeoutRequest): void {
    const now = this.sample();
    if (!now || request.clockFenced || request.sampledAt > now.monotonic || request.clockHighWater > now.wall) {
      watch.stop('clock_integrity');
    }
  }
  status(): TimeoutStatus & { readonly watched: number; readonly running: boolean } {
    this.check();
    return { ready: this.running && !this.closed && !this.failed && [...this.watches.values()].every(watch => !watch.closed && !watch.stopped),
      closed: this.closed, running: this.running, watched: this.watches.size,
      reason: this.failed ? 'clock_integrity' : null,
      stopRequested: [...this.watches.values()].some(watch => watch.stopped) };
  }
  private fail(): void {
    this.failed = true;
    for (const watch of this.watches.values()) watch.stop('clock_integrity');
  }
  private validTime(wall: number, monotonic: number): boolean {
    return Number.isSafeInteger(wall) && wall >= this.lastWall && wall <= 8_640_000_000_000_000
      && Number.isFinite(monotonic) && monotonic >= this.lastMono && monotonic <= Number.MAX_SAFE_INTEGER;
  }
  private sample(): { wall: number; monotonic: number } | null {
    if (this.failed) return null;
    if (this.reading) { this.fail(); return null; }
    this.reading = true;
    try {
      const wall = this.options.wallNow();
      const monotonic = this.options.monotonicNow();
      if (this.failed || !this.validTime(wall, monotonic)) throw new TimeoutError('invalid_input');
      this.lastWall = wall; this.lastMono = monotonic;
      return { wall, monotonic };
    } catch { this.fail(); return null; }
    finally { this.reading = false; }
  }
  private checkWatch(watch: Watch, now: { wall: number; monotonic: number }): void {
    if (now.wall >= watch.absolute || now.monotonic >= watch.deadline) watch.stop('timeout');
  }
  private check(): void {
    if (!this.running || this.closed) return;
    const now = this.sample();
    if (!now || this.closed) return;
    for (const watch of this.watches.values()) this.checkWatch(watch, now);
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true; this.running = false; clearInterval(this.timer);
    this.closing = Promise.resolve().then(async () => {
      const outcomes = await Promise.allSettled([...this.watches.values()].map(watch => watch.close()));
      if (outcomes.some(value => value.status === 'rejected')) throw new TimeoutError('cleanup');
    });
    return this.closing;
  }
}
