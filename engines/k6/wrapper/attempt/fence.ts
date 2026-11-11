import type { StagedHeaders } from '../input/index.js';
import type { ExecutionClock } from '../execution/index.js';
import { AttemptError } from './types.js';
import type { AttemptReason } from './types.js';

/** One sticky original deadline across phases. Timers cancel, never certify IO stop. */
export class AttemptFence {
  readonly controller = new AbortController();
  private wall = -1;
  private mono = -1;
  private wallEnd = Infinity;
  private globalEnd = Infinity;
  private phaseEnd = Infinity;
  private timer: ReturnType<typeof setTimeout> | undefined;
  reason: AttemptReason | null = null;
  private readonly cancel = () => this.stop('cancelled');
  constructor(private readonly clock: ExecutionClock, private readonly parent: AbortSignal, timeout: number) {
    parent.addEventListener('abort', this.cancel, { once: true });
    try { this.phaseEnd = this.check().mono + timeout; this.tick(); }
    catch (error) { this.dispose(); throw error; }
  }
  stop(reason: AttemptReason): void {
    this.reason ??= reason; this.controller.abort(); clearTimeout(this.timer);
  }
  private valid(wall: number, mono: number): boolean {
    return Number.isSafeInteger(wall) && wall >= 0 && wall <= 8_640_000_000_000_000
      && Number.isFinite(mono) && mono >= 0 && wall >= this.wall && mono >= this.mono;
  }
  check(): { wall: number; mono: number } {
    if (this.parent.aborted) this.stop('cancelled');
    if (this.reason) throw new AttemptError(this.reason);
    let wall: number; let mono: number;
    try { wall = this.clock.wall(); mono = this.clock.monotonic(); }
    catch { this.stop('clock'); throw new AttemptError('clock'); }
    if (!this.valid(wall, mono)) this.stop('clock');
    this.wall = wall; this.mono = mono;
    if (wall >= this.wallEnd || mono >= Math.min(this.globalEnd, this.phaseEnd)) this.stop('deadline');
    if (this.reason) throw new AttemptError(this.reason);
    return { wall, mono };
  }
  bind(headers: StagedHeaders): void {
    const sample = this.check();
    if (sample.wall < headers.attempt.deadlineMs - headers.attempt.timeoutMs) {
      this.stop('clock'); throw new AttemptError('clock');
    }
    this.wallEnd = headers.attempt.deadlineMs;
    this.globalEnd = sample.mono + (headers.attempt.deadlineMs - sample.wall);
    this.phaseEnd = this.globalEnd; this.check();
  }
  phase(timeout: number): void {
    const sample = this.check(); this.phaseEnd = Math.min(this.globalEnd, sample.mono + timeout); this.check();
  }
  lifetimeRemaining(): number {
    const sample = this.check();
    return Math.max(1, Math.min(this.wallEnd - sample.wall,
      this.globalEnd - sample.mono, this.phaseEnd - sample.mono));
  }
  remaining(): number {return Math.min(60_000, this.lifetimeRemaining());}
  budget() { return { deadline: performance.now() + this.remaining(), signal: this.controller.signal }; }
  timestamp(): string { return new Date(this.check().wall).toISOString(); }
  private tick(): void {
    try { this.check(); } catch { return; }
    this.timer = setTimeout(() => this.tick(), 25); this.timer.unref();
  }
  dispose(): void { clearTimeout(this.timer); this.parent.removeEventListener('abort', this.cancel); }
}
