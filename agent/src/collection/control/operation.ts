import { ControlReadError, CONTROL_READ_MAX_MS } from './types.js';
import type { ControlReadBudget, ControlReadOperation, ControlReadResult, ControlReadValue } from './types.js';
import type { ReaderPorts } from './ports.js';

export function failure(error: unknown): ControlReadResult {
  return { ok: false, reason: error instanceof ControlReadError ? error.reason : 'io' };
}
export function immediate(reason: ControlReadError['reason']): ControlReadOperation {
  return { result: Promise.resolve({ ok: false, reason }), quiesced: Promise.resolve() };
}
export class Operation {
  private cancelled = false;
  private closed = false;
  private expired = false;
  private finish: ((value: ControlReadResult) => void) | undefined;
  bytes = 0;
  calls = 0;
  constructor(readonly budget: ControlReadBudget, private readonly ports: ReaderPorts) {}
  check(): void {
    if (this.closed) throw new ControlReadError('closed');
    if (this.cancelled || this.budget.signal?.aborted) throw new ControlReadError('cancelled');
    if (this.expired || this.ports.now() >= this.budget.deadline) throw new ControlReadError('deadline');
  }
  stop(): void { this.closed = true; this.finish?.({ ok: false, reason: 'closed' }); }
  async io<T>(action: () => Promise<T>): Promise<T> {
    this.check(); const value = await action(); this.check(); return value;
  }
  run(work: () => Promise<ControlReadValue>, settled: () => void): ControlReadOperation {
    let finish!: (value: ControlReadResult) => void;
    const result = new Promise<ControlReadResult>(resolve => { finish = resolve; });
    this.finish = finish;
    const abort = () => { this.cancelled = true; finish({ ok: false, reason: 'cancelled' }); };
    const timeout = setTimeout(() => { this.expired = true; finish({ ok: false, reason: 'deadline' }); },
      Math.max(0, this.budget.deadline - this.ports.now()));
    this.budget.signal?.addEventListener('abort', abort, { once: true });
    const original = Promise.resolve().then(async () => {
      this.check(); const value = await work(); this.check(); finish({ ok: true, value });
    }).catch(error => finish(failure(error)));
    const quiesced = original.then(() => {
      clearTimeout(timeout); this.budget.signal?.removeEventListener('abort', abort); settled();
    });
    return { result, quiesced };
  }
}
export function snapshotBudget(input: ControlReadBudget, now: number): ControlReadBudget | null {
  try {
    const { deadline, signal, stopped } = input;
    if (!Number.isFinite(deadline) || deadline <= now || deadline - now > CONTROL_READ_MAX_MS
      || typeof stopped !== 'boolean') return null;
    if (signal !== undefined && !(signal instanceof AbortSignal)) return null;
    return Object.freeze({ deadline, stopped, ...(signal === undefined ? {} : { signal }) });
  } catch { return null; }
}
