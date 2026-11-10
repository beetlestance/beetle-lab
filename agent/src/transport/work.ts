import { AgentHttpError, HTTP_LIMITS } from './types.js';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Operation } from '../backends/docker/index.js';
import { SourceWork } from './source-work.js';

/** Retains original service calls independently of socket/response lifetime. */
export class RequestWork {
  private readonly pending = new Set<Promise<unknown>>();
  private readonly sources = new Map<FastifyRequest, SourceWork>();
  private closed = false;
  private closing: Promise<void> | undefined;
  run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new AgentHttpError(503, 'execution_lost', 'transport'));
    if (this.pending.size >= HTTP_LIMITS.operations) return Promise.reject(new AgentHttpError(429, 'budget_unavailable', 'transport'));
    const original = Promise.resolve().then(operation); this.pending.add(original);
    return original.finally(() => { this.pending.delete(original); });
  }
  acquireSource(request: FastifyRequest, reply: FastifyReply): void {
    if (this.closed) throw new AgentHttpError(503, 'execution_lost', 'transport');
    if (this.pending.size >= HTTP_LIMITS.operations || this.sources.size >= HTTP_LIMITS.sourceOperations) {
      throw new AgentHttpError(429, 'budget_unavailable', 'transport');
    }
    let finish!: () => void;
    const original = new Promise<void>(resolve => { finish = resolve; });
    this.pending.add(original);
    const owner = new SourceWork(request, reply, () => {
      this.sources.delete(request); this.pending.delete(original); finish();
    });
    this.sources.set(request, owner);
  }
  source<T>(request: FastifyRequest, operation: (budget: Operation) => Promise<T>): Promise<T> {
    const owner = this.sources.get(request);
    if (this.closed || !owner) return Promise.reject(new AgentHttpError(503, 'execution_lost', 'transport'));
    return owner.run(operation);
  }
  responseFinished(request: FastifyRequest): void { this.sources.get(request)?.responseFinished(); }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    for (const owner of this.sources.values()) owner.close();
    this.closing = Promise.allSettled([...this.pending]).then(() => undefined);
    return this.closing;
  }
}
