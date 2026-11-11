import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiFault } from '../api-errors.js';

/** One transport lifetime, independent of framework request.signal and body EOF. */
export class RequestContext {
  readonly deadline: number;
  readonly controller = new AbortController();
  readonly originals = new Set<Promise<unknown>>();
  private responseDone = false;
  private retired = false;
  private readonly timer: ReturnType<typeof setTimeout>;
  private readonly aborted = () => this.abort();
  private readonly requestClosed = () => { if (!this.request.raw.complete) this.abort(); };
  private readonly responseClosed = () => {
    if (!this.reply.raw.writableFinished) this.abort();
    this.finish();
  };
  private readonly responseFinished = () => this.finish();

  constructor(readonly request: FastifyRequest, readonly reply: FastifyReply,
    private readonly retire: () => void, lifetimeMs = 30_000) {
    this.deadline = performance.now() + lifetimeMs;
    this.timer = setTimeout(() => this.destroy(), lifetimeMs); this.timer.unref();
    request.raw.once('aborted', this.aborted);
    request.raw.once('close', this.requestClosed);
    reply.raw.once('close', this.responseClosed);
    reply.raw.once('finish', this.responseFinished);
  }
  get signal(): AbortSignal { return this.controller.signal; }
  check(): void { if (this.signal.aborted || performance.now() >= this.deadline) throw new ApiFault('storage_unavailable'); }
  abort(): void {
    if (!this.signal.aborted) this.controller.abort();
    if (!this.request.raw.complete) this.request.raw.destroy();
  }
  destroy(): void { this.abort(); this.reply.raw.destroy(); this.finish(); }
  finish(): void { this.responseDone = true; this.release(); }
  private release(): void {
    if (this.retired || !this.responseDone || this.originals.size) return;
    this.retired = true;
    clearTimeout(this.timer);
    this.request.raw.removeListener('aborted', this.aborted);
    this.request.raw.removeListener('close', this.requestClosed);
    this.reply.raw.removeListener('close', this.responseClosed);
    this.reply.raw.removeListener('finish', this.responseFinished);
    this.retire();
  }
  async run<T>(issue: () => Promise<T>): Promise<T> {
    this.check();
    let accept!: (value: T | PromiseLike<T>) => void; let reject!: (error: unknown) => void;
    const original = new Promise<T>((resolve, fail) => { accept = resolve; reject = fail; });
    this.originals.add(original);
    const settle = () => { this.originals.delete(original); this.release(); };
    void original.then(settle, settle);
    let abort!: () => void;
    const cancelled = new Promise<never>((_resolve, reject) => {
      abort = () => reject(new ApiFault('storage_unavailable'));
      this.signal.addEventListener('abort', abort, { once: true });
      if (this.signal.aborted) abort();
    });
    try {
      // Foreign invocation may synchronously reenter close/drain before returning.
      try { accept(issue()); } catch (error) { reject(error); }
      return await Promise.race([original, cancelled]);
    }
    finally { this.signal.removeEventListener('abort', abort); }
  }
  async drain(): Promise<void> { await Promise.allSettled([...this.originals]); }
}
