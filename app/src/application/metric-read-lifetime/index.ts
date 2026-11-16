import { MetricReadError } from '../../ports/run-metrics.js';
import { SemanticError } from '../../domain/namespaces/index.js';
import type { MetricReadContext } from '../../ports/run-metrics.js';
/** Caller failure can precede original settlement; the service retains this owner. */
export class MetricReadOperation {
  readonly controller: AbortController; readonly signal: AbortSignal; readonly deadline: number;
  private readonly timer: ReturnType<typeof setTimeout>;
  constructor(context: MetricReadContext, maximumMs = 30000) {
    if (!(context.signal instanceof AbortSignal) || !Number.isFinite(context.deadline)) throw new SemanticError('invalid_value');
    this.deadline = Math.min(context.deadline, performance.now() + maximumMs);
    this.controller = new AbortController(); this.signal = AbortSignal.any([context.signal, this.controller.signal]);
    this.timer = setTimeout(() => this.controller.abort(), Math.max(0, this.deadline - performance.now())); this.timer.unref?.();
  }
  check(): void { if (this.signal.aborted || performance.now() >= this.deadline) throw new MetricReadError(this.signal.aborted ? 'cancelled' : 'deadline'); }
  dispose(): void { clearTimeout(this.timer); }
  race<T>(original: Promise<T>): Promise<T> {
    let abort!: () => void;
    const cancelled = new Promise<never>((_resolve, reject) => {
      abort = () => reject(new MetricReadError('unavailable'));
      this.signal.addEventListener('abort', abort, {once: true}); if (this.signal.aborted) abort();
    });
    return Promise.race([original, cancelled]).finally(() => this.signal.removeEventListener('abort', abort));
  }
}
