import type { TimeoutReason, TimeoutRequest, TimeoutStatus, TimeoutWatch } from './types.js';
import { TimeoutError } from './types.js';

export class Watch implements TimeoutWatch {
  closed = false;
  stopped = false;
  failed = false;
  reason: TimeoutReason | null = null;
  private original?: Promise<void>;
  private closing?: Promise<void>;
  readonly absolute: number;
  readonly deadline: number;
  constructor(readonly request: Readonly<TimeoutRequest>, private readonly owner: {
    ready(): boolean;
    check(): void;
    stop(reason: TimeoutReason): Promise<unknown>;
    retire(): void;
  }) {
    this.absolute = request.admittedAt + request.timeoutMs;
    this.deadline = request.sampledAt + Math.max(0, this.absolute - request.clockHighWater);
  }
  status(): TimeoutStatus {
    this.owner.check();
    return { ready: this.owner.ready() && !this.closed && !this.stopped,
      closed: this.closed, stopRequested: this.stopped, reason: this.reason };
  }
  stop(reason: TimeoutReason): void {
    if (this.closed || (this.stopped && (reason !== 'clock_integrity' || this.reason === 'clock_integrity'))) return;
    this.stopped = true;
    this.reason = reason;
    const previous = this.original;
    const next = Promise.resolve().then(() => this.owner.stop(reason));
    this.original = Promise.allSettled([previous, next]).then(results => {
      if (results.some(result => result.status === 'rejected')) this.failed = true;
    });
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.closing = Promise.resolve().then(async () => {
      await this.original;
      if (this.failed) throw new TimeoutError('cleanup');
      this.owner.retire();
    });
    return this.closing;
  }
}
