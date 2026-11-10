import { performance } from 'node:perf_hooks';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Operation } from '../backends/docker/index.js';
import { AgentHttpError, HTTP_LIMITS } from './types.js';

/** One pre-body original, retained until service and every transport close settle. */
export class SourceWork {
  private readonly controller = new AbortController();
  private readonly operation: Operation;
  private readonly timer: ReturnType<typeof setTimeout>;
  private readonly socket;
  private requestClosed = false;
  private responseClosed = false;
  private socketClosed = false;
  private issued = false;
  private serviceSettled = true;
  private finished = false;
  constructor(private readonly request: FastifyRequest, private readonly reply: FastifyReply,
    private readonly release: () => void) {
    this.operation = Object.freeze({ deadline: performance.now() + HTTP_LIMITS.requestMs, signal: this.controller.signal });
    this.socket = reply.raw.socket!;
    this.timer = setTimeout(() => this.close(), HTTP_LIMITS.requestMs);
    request.raw.once('end', () => { this.requestClosed = true; this.finish(); });
    request.raw.once('aborted', () => this.controller.abort());
    request.raw.once('close', () => {
      this.requestClosed = true;
      if (!request.raw.complete) this.controller.abort();
      this.finish();
    });
    reply.raw.once('close', () => {
      this.responseClosed = true;
      if (!reply.raw.writableFinished) this.controller.abort();
      this.finish();
    });
    this.socket.once('close', () => {
      this.socketClosed = true; this.controller.abort();
      request.raw.destroy(); reply.raw.destroy(); this.finish();
    });
  }
  private check(): void {
    if (this.controller.signal.aborted || performance.now() >= this.operation.deadline) {
      throw new AgentHttpError(503, 'execution_lost', 'transport');
    }
  }
  async run<T>(operation: (budget: Operation) => Promise<T>): Promise<T> {
    this.check();
    if (this.issued) throw new AgentHttpError(503, 'execution_lost', 'transport');
    this.issued = true; this.serviceSettled = false;
    try {
      // A disconnect/shutdown before this microtask must fence the unissued service.
      const value = await Promise.resolve().then(() => { this.check(); return operation(this.operation); });
      this.check(); return value;
    } finally { this.serviceSettled = true; this.finish(); }
  }
  responseFinished(): void {
    // onResponse follows completed response writes; finish unread request cleanup
    // and the explicit Connection:close socket without waiting for keepalive.
    this.request.raw.resume(); this.request.raw.destroy(); this.socket.end();
  }
  close(): void {
    this.controller.abort(); this.request.raw.destroy(); this.reply.raw.destroy(); this.socket.destroy();
  }
  private finish(): void {
    if (this.finished || !this.serviceSettled) return;
    if (!this.requestClosed || !this.responseClosed || !this.socketClosed) return;
    this.finished = true; clearTimeout(this.timer); this.release();
  }
}
