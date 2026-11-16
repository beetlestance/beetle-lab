import type { InputService, InputRecoveryResult } from '../ports/input-service.js';

const PAGE_SIZE = 16;
const INTERVAL_MS = 5000;
export type InputMaintenanceState = 'waiting' | 'running' | 'failed' | 'closed';
export class InputMaintenanceError extends Error {
  constructor() { super('Input recovery failed'); this.name = 'InputMaintenanceError'; }
}
function continuation(result: InputRecoveryResult): string | undefined {
  const counts = [result.examined, result.reconciled, result.busy, result.pending];
  const cursor = result.nextCursor;
  if (!counts.every(value => Number.isSafeInteger(value) && value >= 0 && value <= PAGE_SIZE)
    || counts[0] !== counts[1]! + counts[2]! + counts[3]!
    || !(cursor === null || (typeof cursor === 'string' && cursor.length > 0 && cursor.length <= 1024))) {
    throw new InputMaintenanceError();
  }
  return cursor ?? undefined;
}

/** One original pending-only page at a time; no scan of ordinary published files.
 * This owns scheduling, not byte custody. Bootstrap independently closes InputService.
 */
export class InputMaintenance {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private controller: AbortController | undefined;
  private active: Promise<void> | undefined;
  private cursor: string | undefined;
  private failed = false;
  private closed = false;
  private closing: Promise<void> | undefined;
  constructor(private readonly inputs: Pick<InputService, 'recover'>) { this.schedule(0); }
  get state(): InputMaintenanceState {
    if (this.failed) return 'failed';
    if (this.closed) return 'closed';
    return this.active ? 'running' : 'waiting';
  }
  private schedule(delay: number): void {
    if (this.closed || this.failed) return;
    this.timer = setTimeout(() => this.tick(), delay); this.timer.unref();
  }
  private tick(): void {
    this.timer = undefined;
    if (this.closed || this.active) return;
    const controller = new AbortController(); this.controller = controller;
    this.active = Promise.resolve().then(() => {
      if (controller.signal.aborted) throw new InputMaintenanceError();
      return this.inputs.recover({ limit: PAGE_SIZE, mode: 'pending',
        ...(this.cursor === undefined ? {} : { cursor: this.cursor }) }, { signal: controller.signal });
    }).then(result => {
      if (!this.closed) this.cursor = continuation(result);
    }).catch(() => { if (!this.closed) this.failed = true; }).finally(() => {
      this.active = undefined; this.controller = undefined;
      this.schedule(INTERVAL_MS);
    });
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined; this.controller?.abort();
    this.closing = (this.active ?? Promise.resolve()).then(() => { if (this.failed) throw new InputMaintenanceError(); });
    return this.closing;
  }
}
