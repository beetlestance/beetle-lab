import { performance } from 'node:perf_hooks';
import type { Operation, ResourceReading } from '../backends/docker/index.js';
import { ResourceAggregate } from './aggregate.js';
import type { ResourceSummary } from './aggregate.js';

interface Clock { wall(): number; monotonic(): number }
/** One shared admission, no waiting queue; late originals retain their slots. */
export class SamplingAdmission {
  private active = 0;
  acquire(): (() => void) | undefined {
    if (this.active >= 2) return undefined;
    this.active++;
    return () => { this.active--; };
  }
}
interface MonitorOptions {
  clock: Clock; admission: SamplingAdmission;
  read(operation: Operation): Promise<ResourceReading>;
}
/** Actor ticks drive cadence. Only the deadline timer exists while an original is held. */
export class AttemptResources {
  private readonly aggregate = new ResourceAggregate(['cpu', 'memory', 'pids']);
  private started = false;
  private fenced = false;
  private nextSample = 0;
  private nextPublication = 0;
  private lastWall = 0;
  private lastMono = 0;
  private original: Promise<void> | undefined;
  private abort: AbortController | undefined;
  private closing: Promise<void> | undefined;
  constructor(private readonly options: MonitorOptions) {}
  get pending(): boolean { return this.original !== undefined; }
  running(restarted: boolean): void {
    if (this.started || this.fenced) return;
    this.started = true;
    if (restarted) this.aggregate.restarted();
    const mono = this.options.clock.monotonic();
    this.nextPublication = Number.isFinite(mono) ? mono + 5000 : Infinity;
  }
  tick(): void {
    if (!this.started || this.fenced) return;
    const mono = this.options.clock.monotonic(); const wall = this.options.clock.wall();
    if (!this.validClock(mono, wall)) { this.aggregate.miss(1, 'clock'); return; }
    if (this.nextPublication === Infinity) this.nextPublication = mono + 5000;
    if (mono < this.nextSample) return;
    const due = this.nextSample === 0 ? 1 : Math.floor((mono - this.nextSample) / 1000) + 1;
    this.nextSample = mono + 1000;
    if (due > 1) this.aggregate.miss(due - 1);
    const release = this.original ? undefined : this.options.admission.acquire();
    if (!release) { this.aggregate.miss(); return; }
    this.issue(wall, release);
  }
  private validClock(mono: number, wall: number): boolean {
    const valid = Number.isFinite(mono) && mono <= Number.MAX_SAFE_INTEGER - 5000 && mono >= this.lastMono && Number.isSafeInteger(wall)
      && wall >= this.lastWall && wall <= 8_640_000_000_000_000;
    if (valid) { this.lastMono = mono; this.lastWall = wall; }
    return valid;
  }
  private issue(wall: number, release: () => void): void {
    const abort = this.abort = new AbortController(); const deadline = performance.now() + 1000;
    const timer = setTimeout(() => abort.abort(), 1000);
    // Defer dispatch until the retained original is installed, including reentrant close.
    this.original = Promise.resolve().then(() => this.options.read({ deadline, signal: abort.signal })).then(reading => {
      if (abort.signal.aborted || performance.now() >= deadline) this.aggregate.miss();
      else if (!this.validClock(this.options.clock.monotonic(), this.options.clock.wall())) this.aggregate.miss(1, 'clock');
      else this.aggregate.observe(reading, wall);
    }, () => { this.aggregate.miss(); }).finally(() => {
      clearTimeout(timer); release(); this.original = undefined; this.abort = undefined;
    });
  }
  due(): ResourceSummary | undefined {
    if (!this.started || this.fenced) return undefined;
    const mono = this.options.clock.monotonic();
    if (!Number.isFinite(mono) || mono < this.lastMono || mono < this.nextPublication) return undefined;
    this.nextPublication = mono + 5000;
    return this.aggregate.summary();
  }
  coalesced(): void { this.aggregate.miss(); }
  /** Abort does not release ownership. An ignored abort keeps close pending. */
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.fenced = true;
    this.closing = Promise.resolve().then(() => this.original);
    this.abort?.abort();
    return this.closing;
  }
  final(): ResourceSummary | undefined { return this.started ? this.aggregate.summary() : undefined; }
}
