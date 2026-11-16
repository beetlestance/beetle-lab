import { JournalError } from './errors.js';

export interface OperationBudget {
  /** Absolute performance.now() deadline, at most 60 seconds in the future. */
  readonly deadline: number;
  readonly signal?: AbortSignal;
}

/** One explicit operation timer; kernel I/O may settle later and is never retried. */
export class Operation {
  private stopped: JournalError | undefined;
  constructor(private readonly budget: OperationBudget) {
    const remaining = budget.deadline - performance.now();
    if (!Number.isFinite(remaining) || remaining > 60_000) throw new JournalError('invalid_options');
    this.check();
  }
  check(): void {
    if (this.stopped) throw this.stopped;
    if (this.budget.signal?.aborted) throw new JournalError('cancelled');
    if (performance.now() >= this.budget.deadline) throw new JournalError('deadline');
  }
  async wait<T>(work: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    const stop = new Promise<never>((_resolve, reject) => {
      const fail = (code: 'deadline' | 'cancelled') => {
        this.stopped = new JournalError(code); reject(this.stopped);
      };
      abort = () => fail('cancelled');
      this.budget.signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => fail('deadline'), Math.max(0, this.budget.deadline - performance.now()));
      if (this.budget.signal?.aborted) abort();
    });
    try { const result = await Promise.race([work, stop]); this.check(); return result; }
    finally {
      clearTimeout(timer);
      if (abort) this.budget.signal?.removeEventListener('abort', abort);
    }
  }
}
