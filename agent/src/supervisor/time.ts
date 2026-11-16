import type { Reservation } from '../admission/index.js';
import type { SupervisionState } from '../journal/index.js';
import type { Operation } from '../backends/docker/index.js';
import type { Clock } from './types.js';

/** Durable wall high-water plus local monotonic ceilings; neither deadline can grow. */
export class AttemptTime {
  private lastMono = -Infinity;
  private lastWall = 0;
  private absolute = Infinity;
  private broken = false;
  private deadline = Infinity;
  private grace = Infinity;
  constructor(private readonly clock: Clock) {}
  wall(): number {
    const value = this.clock.wall();
    if (!Number.isSafeInteger(value) || value < 0 || value > 8_640_000_000_000_000) {
      this.broken = true; return 0;
    }
    if (value < this.lastWall) this.broken = true;
    this.lastWall = Math.max(this.lastWall, value);
    return value;
  }
  private monotonic(): number {
    const value = this.clock.monotonic();
    if (!Number.isFinite(value) || value < 0 || value < this.lastMono) { this.broken = true; return this.lastMono; }
    this.lastMono = value; return value;
  }
  capture(): { wall: number; monotonic: number } { return { wall: this.wall(), monotonic: this.monotonic() }; }
  update(state: SupervisionState, issuedAt: number, reservation?: Reservation): void {
    this.broken ||= state.clockFenced;
    if (state.cancelRequested && state.cancelRequestedAt === null) this.broken = true;
    // Fenced inherited clocks can exceed Date's range. They are never arithmetic inputs.
    if (this.broken) return;
    if (reservation) this.executionDeadline(state, reservation, issuedAt);
    if (state.cancelRequestedAt !== null) {
      const remaining = Math.max(0, 5000 - (state.clockHighWater - state.cancelRequestedAt));
      this.grace = Math.min(this.grace, issuedAt + remaining);
    }
  }
  private executionDeadline(state: SupervisionState, reservation: Reservation, mono: number): void {
    if (reservation.budget.timeoutMs > Number.MAX_SAFE_INTEGER - reservation.admittedAt) {
      this.broken = true; return;
    }
    const absolute = reservation.admittedAt + reservation.budget.timeoutMs;
    this.absolute = absolute;
    this.deadline = Math.min(this.deadline, mono + Math.max(0, absolute - state.clockHighWater));
  }
  fenced(): boolean { this.monotonic(); this.wall(); return this.broken; }
  graceElapsed(): boolean { return this.monotonic() >= this.grace; }
  graceDeadline(): number { return this.grace; }
  /** One sample owns both permission and its operation; no later clock read can revive it. */
  dispatch(): { allowed: true; operation: Operation } | { allowed: false; reason: 'clock_integrity' | 'timeout' } {
    const now = this.capture();
    if (this.broken) return { allowed: false, reason: 'clock_integrity' };
    const deadline = Math.min(now.monotonic + 30_000, this.deadline);
    if (!Number.isFinite(deadline)) { this.broken = true; return { allowed: false, reason: 'clock_integrity' }; }
    if (now.monotonic >= deadline || now.wall >= this.absolute) return { allowed: false, reason: 'timeout' };
    return { allowed: true, operation: { deadline } };
  }
  /** Recovery/termination is best effort even with a fenced wall clock. Never grants launch. */
  operation(): Operation { return { deadline: this.monotonic() + 30_000 }; }
}
