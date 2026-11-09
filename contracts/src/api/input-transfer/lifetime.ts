import type { InputTransferFailure } from '../input-transfer-types.js';

/** One carrier remains present until every original and its cleanup have settled. */
export class Operation {
  readonly controller = new AbortController();
  readonly done: Promise<void>;
  issued = false;
  cleanupFailed = false;
  private resolve!: () => void;
  private cause: 'cancelled' | 'timeout' | undefined;
  private reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  private cancellation: Promise<void> | undefined;
  private cancelling = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private caller: AbortSignal | undefined;
  private readonly onCaller = () => this.abort('cancelled');
  private readonly onAbort = () => this.cancel();

  constructor() { this.done = new Promise(resolve => { this.resolve = resolve; }); }
  start(caller: AbortSignal | undefined, timeout: number): void {
    this.controller.signal.addEventListener('abort', this.onAbort, { once: true });
    this.caller = caller;
    caller?.addEventListener('abort', this.onCaller, { once: true });
    this.timer = setTimeout(() => this.abort('timeout'), timeout);
    if (caller?.aborted) this.abort('cancelled');
  }
  abort(cause: 'cancelled' | 'timeout'): void {
    if (this.cause) return;
    this.cause = cause;
    this.controller.abort();
  }
  check(): void { if (this.cause) throw new Error('interrupted'); }
  failure(fallback: InputTransferFailure['kind']): InputTransferFailure {
    return { kind: this.cause ?? fallback };
  }
  acquire(body: ReadableStream<Uint8Array> | null): void {
    if (!body) return;
    this.reader = body.getReader();
    if (this.controller.signal.aborted) this.cancel();
  }
  async read(): Promise<Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>['read']>>> {
    this.check();
    if (!this.reader) return { done: true, value: undefined };
    const value = await this.reader.read();
    this.check();
    return value;
  }
  cancel(): void {
    if (!this.reader || this.cancelling) return;
    this.cancelling = true;
    try {
      this.cancellation = Promise.resolve(this.reader.cancel()).then(() => undefined, () => { this.cleanupFailed = true; });
    } catch { this.cleanupFailed = true; }
  }
  async finish(success: boolean): Promise<void> {
    if (!success) this.cancel();
    if (this.cancellation) await this.cancellation;
    try { this.reader?.releaseLock(); } catch { this.cleanupFailed = true; }
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.caller?.removeEventListener('abort', this.onCaller);
    this.controller.signal.removeEventListener('abort', this.onAbort);
  }
  retire(): void { this.resolve(); }
}
