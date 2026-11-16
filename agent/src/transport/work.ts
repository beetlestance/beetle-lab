import { AgentHttpError, HTTP_LIMITS } from './types.js';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Operation } from '../backends/docker/index.js';
import { SourceWork } from './source-work.js';

/** Retains original service calls independently of socket/response lifetime. */
export class RequestWork {
  private readonly pending = new Set<Promise<unknown>>();
  private readonly sources = new Map<FastifyRequest, SourceWork>();
  private readonly telemetry = new Map<FastifyRequest, SourceWork>();
  private closed = false;
  private closing: Promise<void> | undefined;
  run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new AgentHttpError(503, 'execution_lost', 'transport'));
    if (this.pending.size >= HTTP_LIMITS.operations) return Promise.reject(new AgentHttpError(429, 'budget_unavailable', 'transport'));
    const original = Promise.resolve().then(operation); this.pending.add(original);
    return original.finally(() => { this.pending.delete(original); });
  }
  acquireSource(request: FastifyRequest, reply: FastifyReply): void {
    this.acquire(request, reply, this.sources, HTTP_LIMITS.requestMs);
  }
  acquireLive(request: FastifyRequest, reply: FastifyReply): void {
    this.acquire(request, reply, this.telemetry, 5000);
  }
  private acquire(request: FastifyRequest, reply: FastifyReply, owners: Map<FastifyRequest, SourceWork>, lifetimeMs: number): void {
    if (this.closed) throw new AgentHttpError(503, 'execution_lost', 'transport');
    if (this.pending.size >= HTTP_LIMITS.operations || owners.size >= HTTP_LIMITS.sourceOperations) {
      throw new AgentHttpError(429, 'budget_unavailable', 'transport');
    }
    let finish!: () => void;
    const original = new Promise<void>(resolve => { finish = resolve; });
    this.pending.add(original);
    const owner = new SourceWork(request, reply, () => {
      owners.delete(request); this.pending.delete(original); finish();
    }, lifetimeMs);
    owners.set(request, owner);
  }
  source<T>(request: FastifyRequest, operation: (budget: Operation) => Promise<T>): Promise<T> {
    return this.finite(this.sources, request, operation);
  }
  live<T>(request: FastifyRequest, operation: (budget: Operation) => Promise<T>): Promise<T> {
    return this.finite(this.telemetry, request, operation);
  }
  private finite<T>(owners: Map<FastifyRequest, SourceWork>, request: FastifyRequest,
    operation: (budget: Operation) => Promise<T>): Promise<T> {
    const owner = owners.get(request);
    if (this.closed || !owner) return Promise.reject(new AgentHttpError(503, 'execution_lost', 'transport'));
    return owner.run(operation);
  }
  responseFinished(request: FastifyRequest): void {
    (this.sources.get(request) ?? this.telemetry.get(request))?.responseFinished();
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    for (const owner of [...this.sources.values(), ...this.telemetry.values()]) owner.close();
    this.closing = Promise.allSettled([...this.pending]).then(() => undefined);
    return this.closing;
  }
}
