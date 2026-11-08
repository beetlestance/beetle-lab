import { AgentHttpError, HTTP_LIMITS } from './types.js';

/** Retains original service calls independently of socket/response lifetime. */
export class RequestWork {
  private readonly pending = new Set<Promise<unknown>>();
  private closed = false;
  private closing: Promise<void> | undefined;
  run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new AgentHttpError(503, 'execution_lost', 'transport'));
    if (this.pending.size >= HTTP_LIMITS.operations) return Promise.reject(new AgentHttpError(429, 'budget_unavailable', 'transport'));
    const original = Promise.resolve().then(operation); this.pending.add(original);
    return original.finally(() => { this.pending.delete(original); });
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.closing = Promise.allSettled([...this.pending]).then(() => undefined);
    return this.closing;
  }
}
