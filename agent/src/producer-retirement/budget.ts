import type { Operation } from '../backends/docker/index.js';
import { ProducerRetirementError } from './types.js';
import type { RetirementOutcome } from './types.js';
/** One budget begins before preflight; expiry returns to caller without releasing issued originals. */
export class RetirementBudget {
  readonly expired: Promise<RetirementOutcome>;
  readonly operation: Operation;
  private readonly controller = new AbortController();
  private readonly timer: ReturnType<typeof setTimeout>;
  private resolve!: (value: RetirementOutcome) => void;
  private stopped = false;
  private last: number;
  constructor(private readonly now: () => number, milliseconds: number) {
    this.last = this.clock();
    if (!Number.isSafeInteger(milliseconds) || milliseconds < 1 || milliseconds > 30_000
      || this.last > Number.MAX_SAFE_INTEGER - milliseconds) throw new ProducerRetirementError('invalid_input');
    this.operation = Object.freeze({ deadline: this.last + milliseconds, signal: this.controller.signal });
    this.expired = new Promise(resolve => { this.resolve = resolve; });
    this.timer = setTimeout(() => this.stop('expired'), milliseconds);
  }
  private clock(): number {
    try { const at = this.now(); if (!Number.isFinite(at) || at < 0 || at > Number.MAX_SAFE_INTEGER) throw new Error(); return at; }
    catch { throw new ProducerRetirementError('invalid_input'); }
  }
  check(): void {
    const at = this.clock();
    if (at < this.last) { this.stop('expired'); throw new ProducerRetirementError('expired'); }
    this.last = at;
    if (at >= this.operation.deadline) this.stop('expired');
    if (this.stopped) throw new ProducerRetirementError('expired');
  }
  stop(reason: 'closed' | 'expired'): void {
    if (this.stopped) return; this.stopped = true; this.resolve(Object.freeze({ ok: false, reason })); this.controller.abort();
  }
  finish(): void { clearTimeout(this.timer); }
}
