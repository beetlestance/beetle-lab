import { performance } from 'node:perf_hooks';
import { approvalSnapshot, frameSnapshot, frameRejection, sourceTime } from './frame.js';
import type { Position } from './frame.js';
import type { Operation } from '../backends/docker/index.js';
import type { LiveMetricRead, LiveMetricReaderOptions, LiveMetricReadFailure } from './types.js';
export type { LiveMetricApproval, LiveMetricRead, LiveMetricReadFailure, LiveMetricReaderOptions } from './types.js';
class ReaderClockError extends Error {}
const failed = (reason: LiveMetricReadFailure): LiveMetricRead => ({ok: false, reason});
/** One active owner, one original read, scalar ordering state, no retained metric corpus. */
export class LiveMetricReader {
  private readonly approval;
  private readonly readPort;
  private readonly clock;
  private readonly controller = new AbortController();
  private original: Promise<LiveMetricRead> | undefined;
  private closing: Promise<void> | undefined;
  private staleAt = Infinity;
  private previous: Position | undefined;
  private lastWall = -1;
  private lastMono = -1;
  constructor(options: LiveMetricReaderOptions) {
    this.approval = approvalSnapshot(options.approval); this.readPort = options.read.bind(options);
    this.clock = options.clock ? {wall: options.clock.wall.bind(options.clock), monotonic: options.clock.monotonic.bind(options.clock)}
      : {wall: Date.now, monotonic: () => performance.now()};
  }
  get pending(): boolean { return this.original !== undefined; }
  read(operation: Operation): Promise<LiveMetricRead> {
    if (this.closing) return Promise.resolve(failed('closed'));
    if (this.original) return Promise.resolve(failed('busy'));
    if (!validOperation(operation)) return Promise.resolve(failed('invalid_input'));
    const signal = AbortSignal.any([this.controller.signal, ...(operation.signal ? [operation.signal] : [])]);
    let now;
    try {now = this.sample();} catch {return Promise.resolve(failed('clock'));}
    if (signal.aborted) return Promise.resolve(failed('aborted'));
    if (now.monotonic >= operation.deadline) return Promise.resolve(failed('deadline'));
    const budget = {deadline: Math.min(operation.deadline, now.monotonic + 5000), signal};
    const original = Promise.resolve().then(() => this.capture(budget));
    this.original = original;
    return original.finally(() => {if (this.original === original) this.original = undefined;});
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    const original = this.original; this.closing = Promise.resolve().then(async () => {await original;});
    this.controller.abort(); return this.closing;
  }
  private sample() {
    const wall = this.clock.wall(); const monotonic = this.clock.monotonic();
    if (!Number.isSafeInteger(wall) || wall < 0 || wall > 8640000000000000 || !Number.isFinite(monotonic)
      || monotonic < 0 || monotonic > Number.MAX_SAFE_INTEGER || wall < this.lastWall || monotonic < this.lastMono) throw new ReaderClockError();
    this.lastWall = wall; this.lastMono = monotonic; return {wall, monotonic};
  }
  private boundary(budget: Operation): LiveMetricReadFailure | undefined {
    const now = this.sample();
    if (budget.signal?.aborted) return this.closing ? 'closed' : 'aborted';
    return now.monotonic >= budget.deadline ? 'deadline' : undefined;
  }
  private async capture(budget: Operation): Promise<LiveMetricRead> {
    try {
      const before = this.boundary(budget); if (before) return failed(before);
      const reply = await this.readPort(budget);
      const after = this.boundary(budget); if (after) return failed(after);
      if (!reply.ok || reply.status !== 200 || !reply.image) return failed('unavailable');
      return this.validateFrame(reply.image, budget);
    } catch (error) {return failed(error instanceof ReaderClockError ? 'clock' : 'unavailable');}
  }
  private validateFrame(image: Uint8Array, budget: Operation): LiveMetricRead {
    const snapshot = frameSnapshot(image);
    const final = this.boundary(budget); if (final) return failed(final);
    const rejection = frameRejection({...snapshot, previous: this.previous, approval: this.approval, wall: this.lastWall});
    if (rejection) return failed(rejection);
    if (this.previous?.revision === snapshot.position.revision) {
      if (this.lastMono > this.staleAt) return failed('stale');
    } else this.staleAt = this.lastMono + 6000 - (this.lastWall - sourceTime(snapshot.frame));
    this.previous = snapshot.position; return {ok: true, frame: snapshot.frame};
  }
}
function validOperation(input: Operation): boolean {
  return !!input && Number.isFinite(input.deadline) && (input.signal === undefined || input.signal instanceof AbortSignal);
}
