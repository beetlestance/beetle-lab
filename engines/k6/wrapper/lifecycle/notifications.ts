import type { ControlEvent } from '@beetle/contracts';
export type EventNotification = (event: ControlEvent, signal: AbortSignal) => Promise<void>;
import type { AttemptFence } from './fence.js';

/** At most one original notification, retained even after its bounded wait expires. */
export class Notifications {
  status: 'complete' | 'disabled' | 'failed' = 'complete';
  private original: Promise<void> = Promise.resolve();
  private pending = false;
  constructor(private readonly callback: EventNotification | undefined, private readonly fence: AttemptFence) {}
  async send(event: ControlEvent): Promise<void> {
    if (!this.callback || this.status !== 'complete') return;
    const cancel = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const abort = () => cancel.abort();
    this.fence.controller.signal.addEventListener('abort', abort, { once: true });
    if (this.fence.controller.signal.aborted) abort();
    this.pending = true;
    this.original = Promise.resolve().then(() => this.callback!(event, cancel.signal));
    void this.original.then(() => { this.pending = false; }, () => { this.pending = false; });
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { cancel.abort(); reject(new Error('notification')); }, Math.min(1000, this.fence.remaining()));
    });
    try { await Promise.race([this.original, expired]); }
    catch { this.status = this.pending ? 'disabled' : 'failed'; }
    finally {
      clearTimeout(timer); this.fence.controller.signal.removeEventListener('abort', abort);
    }
  }
  async quiesce(): Promise<void> {
    try { await this.original; }
    catch { this.status = 'failed'; }
  }
}
