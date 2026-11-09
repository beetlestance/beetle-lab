import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ApiFault } from '../api-errors.js';
import { RequestContext } from './context.js';

export class RequestLifetimes {
  private closed = false;
  private closing?: Promise<void>;
  private readonly active = new Set<RequestContext>();
  private readonly requests = new WeakMap<FastifyRequest, RequestContext>();
  private readonly signals = new WeakMap<AbortSignal, RequestContext>();
  register(server: FastifyInstance): void {
    server.addHook('onRequest', async (request, reply) => {
      if (this.closed || this.active.size >= 64) throw new ApiFault('capacity_unavailable');
      const context = new RequestContext(request, reply, () => this.active.delete(context));
      this.active.add(context); this.requests.set(request, context); this.signals.set(context.signal, context);
    });
    server.addHook('onSend', async (request, reply, payload) => {
      if (!request.raw.complete) reply.header('Connection', 'close');
      return payload;
    });
    server.addHook('onResponse', async (request, reply) => {
      this.requests.get(request)?.finish();
      if (!request.raw.complete) {
        if (reply.raw.writableFinished) request.raw.destroy();
        else reply.raw.once('finish', () => request.raw.destroy());
      }
    });
    server.addHook('preClose', async () => this.close());
  }
  forRequest(request: FastifyRequest): RequestContext {
    const context = this.requests.get(request);
    if (!context) throw new ApiFault('storage_unavailable');
    return context;
  }
  forSignal(signal: AbortSignal | undefined): RequestContext {
    const context = signal && this.signals.get(signal);
    if (!context) throw new ApiFault('storage_unavailable');
    return context;
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    const contexts = [...this.active];
    for (const context of contexts) context.destroy();
    this.closing = Promise.all(contexts.map(context => context.drain())).then(() => undefined);
    return this.closing;
  }
}
