import type { OutputWatch, OutputWatchRequest, GuardStopReason, OutputWatchStatus } from './types.js';
import { GuardError } from './types.js';

export class Watch implements OutputWatch {
  readonly initial: Promise<{ readonly ready: boolean }>;
  private resolveInitial!: (value: { ready: boolean }) => void;
  private closing?: Promise<void>;
  closed = false;
  failed = false;
  stopped = false;
  lastKnownAt: number | null = null;
  registeredAt: number | null = null;
  due = 0;
  scan: Promise<void> | undefined;
  stopOriginal?: Promise<void>;
  controller: AbortController | undefined;
  constructor(readonly request: OutputWatchRequest, private readonly retire: () => void,
    private readonly stopPort: (reason: GuardStopReason) => Promise<unknown>, private readonly refresh: () => void) {
    this.initial = new Promise(resolve => { this.resolveInitial = resolve; });
  }
  status(): OutputWatchStatus {
    this.refresh();
    return { ready: !this.closed && !this.stopped && this.lastKnownAt !== null,
      closed: this.closed, stopRequested: this.stopped, lastKnownAt: this.lastKnownAt };
  }
  initialResult(ready: boolean): void { this.resolveInitial({ ready }); }
  stop(reason: GuardStopReason): void {
    if (this.closed || this.stopped) return;
    this.stopped = true;
    this.initialResult(false);
    // Reserve the original before invoking a reentrant installation callback.
    this.stopOriginal = Promise.resolve().then(() => this.stopPort(reason)).then(() => undefined,
      () => { this.failed = true; });
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.initialResult(false);
    this.closing = Promise.resolve().then(() => this.drain());
    this.controller?.abort();
    return this.closing;
  }
  private async drain(): Promise<void> {
    await Promise.all([this.scan, this.stopOriginal]);
    if (this.failed) throw new GuardError('cleanup');
    this.retire();
  }
}
