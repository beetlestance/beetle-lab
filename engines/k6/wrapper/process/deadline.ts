import { ProcessBoundaryError } from './types.js';
import type { NativeProcessOptions } from './types.js';

/** A wall authority plus a nonextending local monotonic ceiling; every decision resamples both. */
export class Deadline {
  private wall: number;
  private mono: number;
  private readonly end: number;
  constructor(private readonly input: NativeProcessOptions) {
    const sample = this.sample();
    this.wall = sample.wall;
    this.mono = sample.mono;
    this.validate(this.wall, this.mono);
    if (input.attempt.mode !== 'managed') throw new ProcessBoundaryError('profile');
    const remaining = Math.min(input.attempt.timeoutMs, input.attempt.deadlineMs - this.wall);
    this.end = this.mono + remaining;
    if (remaining <= 0 || !Number.isFinite(this.end)) throw new ProcessBoundaryError('deadline');
  }
  private sample(): { wall: number; mono: number } {
    try { return { wall: this.input.clock?.wall() ?? Date.now(),
      mono: this.input.clock?.monotonic() ?? performance.now() }; }
    catch { throw new ProcessBoundaryError('clock'); }
  }
  private validate(wall: number, mono: number): void {
    if (!Number.isSafeInteger(wall) || wall < 0 || !Number.isFinite(mono) || mono < 0) {
      throw new ProcessBoundaryError('clock');
    }
  }
  remaining(): number {
    const { wall, mono } = this.sample();
    this.validate(wall, mono);
    if (wall < this.wall || mono < this.mono) throw new ProcessBoundaryError('clock');
    this.wall = wall; this.mono = mono;
    const remaining = Math.min(this.end - mono, this.input.attempt.mode === 'managed'
      ? this.input.attempt.deadlineMs - wall : 0);
    if (remaining <= 0) throw new ProcessBoundaryError('deadline');
    return remaining;
  }
}
