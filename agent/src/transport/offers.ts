import type { FastifyRequest } from 'fastify';
import { AgentHttpError } from './types.js';

interface Owner {
  readonly request: FastifyRequest;
  readonly done: Promise<void>;
  finish(): void;
  issued: boolean;
}
/** Two body owners, retained until the original Offer or cancellation settles, without a waiting queue. */
export class OfferIngress {
  private readonly owners = new Map<FastifyRequest, Owner>();
  private closed = false;
  acquire(request: FastifyRequest): void {
    if (this.closed) throw new AgentHttpError(503, 'execution_lost', 'transport');
    if (this.owners.size >= 2) throw new AgentHttpError(429, 'budget_unavailable', 'transport');
    let finish!: () => void;
    const done = new Promise<void>(resolve => { finish = resolve; });
    this.owners.set(request, { request, done, finish, issued: false });
    request.raw.once('aborted', () => this.releaseRequest(request));
    request.raw.once('close', () => {
      // A normal completed request stream says nothing about response/enqueue completion.
      if (this.closed || !request.raw.complete) this.releaseRequest(request);
    });
  }
  releaseRequest(request: FastifyRequest): void {
    const owner = this.owners.get(request);
    if (owner && !owner.issued) this.finish(owner);
  }
  async run<T>(request: FastifyRequest, operation: () => Promise<T>): Promise<T> {
    const owner = this.owners.get(request);
    if (this.closed || !owner) throw new AgentHttpError(503, 'execution_lost', 'transport');
    owner.issued = true;
    try { return await operation(); }
    finally { this.finish(owner); }
  }
  close(): Promise<void> {
    this.closed = true;
    const pending = [...this.owners.values()];
    for (const owner of pending) {
      if (!owner.issued) {
        // Stop owned stalled parsers; close/aborted establishes stream settlement.
        owner.request.raw.destroy();
        if (owner.request.raw.closed) this.releaseRequest(owner.request);
      }
    }
    return Promise.all(pending.map(owner => owner.done)).then(() => undefined);
  }
  private finish(owner: Owner): void {
    if (this.owners.get(owner.request) !== owner) return;
    this.owners.delete(owner.request); owner.finish();
  }
}
