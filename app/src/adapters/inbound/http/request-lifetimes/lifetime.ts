import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ApiFault } from '../api-errors.js';
import { RequestContext } from './context.js';

export class RequestLifetimes {
  constructor(
    private readonly limit = 64,
    private readonly lifetimeMs = 30_000,
    private readonly waitMs = 0,
  ) {}
  private closed = false;
  private closing?: Promise<void>;
  private readonly active = new Set<RequestContext>();
  private readonly contexts = new Set<RequestContext>();
  private wake?: (() => void) | undefined;
  private readonly requests = new WeakMap<FastifyRequest, RequestContext>();
  private readonly signals = new WeakMap<AbortSignal, RequestContext>();
  register(server: FastifyInstance): void {
    server.addHook('onRequest', async (request, reply) => {
      // Authorization may have awaited IO before this hook; terminal events can already be gone.
      // IncomingMessage completion alone is healthy and must not retire a request.
      if (request.raw.aborted || reply.raw.destroyed || reply.raw.writableFinished)
        throw new ApiFault('storage_unavailable');
      const capacity = this.limit + (this.waitMs > 0 ? 1 : 0);
      if (this.closed || this.contexts.size >= capacity) throw new ApiFault('capacity_unavailable');
      const context = new RequestContext(request, reply, () => this.retire(context), this.lifetimeMs);
      this.contexts.add(context);
      this.requests.set(request, context);
      this.signals.set(context.signal, context);
      if (this.active.size < this.limit) this.active.add(context);
      else await this.wait(context);
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
  private retire(context: RequestContext): void {
    this.contexts.delete(context);
    this.active.delete(context);
    if (!this.closed && this.active.size < this.limit) this.wake?.();
  }
  /** One waiting HTTP context, with no originals or byte reservations until admitted. */
  private wait(context: RequestContext): Promise<void> {
    const deadline = Math.min(context.deadline, performance.now() + this.waitMs);
    return new Promise((resolve, reject) => {
      const clean = () => {
        clearTimeout(timer);
        context.signal.removeEventListener('abort', abort);
        this.wake = undefined;
      };
      const refuse = (code: 'storage_unavailable' | 'capacity_unavailable') => {
        clean();
        reject(new ApiFault(code));
      };
      const abort = () => refuse('storage_unavailable');
      const timer = setTimeout(() => refuse('capacity_unavailable'), Math.ceil(deadline - performance.now()));
      timer.unref();
      this.wake = () => {
        if (context.signal.aborted) return abort();
        if (performance.now() >= deadline) return refuse('capacity_unavailable');
        clean();
        this.active.add(context);
        resolve();
      };
      context.signal.addEventListener('abort', abort, { once: true });
      if (context.signal.aborted) abort();
    });
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
    const contexts = [...this.contexts];
    for (const context of contexts) context.destroy();
    this.closing = Promise.all(contexts.map((context) => context.drain())).then(() => undefined);
    return this.closing;
  }
}
