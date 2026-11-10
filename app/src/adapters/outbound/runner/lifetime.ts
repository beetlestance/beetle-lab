import type { ClientResult } from '@beetle/contracts';

export interface OriginalCall {
  readonly signal: AbortSignal;
  readonly done: Promise<void>;
  readonly offer: boolean;
  failure(): 'cancelled' | 'timeout' | undefined;
  abort(): void;
  finish(): void;
}

interface PendingCall extends OriginalCall { start(caller?: AbortSignal): void }

/** Construct internal custody without observing caller-owned registration hooks. */
function original(offer: boolean): PendingCall {
  const controller = new AbortController();
  let cause: 'cancelled' | 'timeout' | undefined;
  let caller: AbortSignal | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let complete!: () => void;
  const done = new Promise<void>(resolve => { complete = resolve; });
  const stop = (reason: 'cancelled' | 'timeout') => {
    if (cause) return;
    cause = reason;
    controller.abort();
  };
  const abort = () => stop('cancelled');
  return {
    offer, signal: controller.signal, done, failure: () => cause, abort,
    start: signal => {
      caller = signal;
      timer = setTimeout(() => stop('timeout'), 5000);
      caller?.addEventListener('abort', abort, { once: true });
      if (caller?.aborted) abort();
    },
    finish: () => {
      clearTimeout(timer);
      try { caller?.removeEventListener('abort', abort); } finally { complete(); }
    },
  };
}

/** A stop hint cannot erase validated evidence already returned by original work. */
function settledResult<T>(result: ClientResult<T>, failure: 'cancelled' | 'timeout' | undefined): ClientResult<T> {
  if (result.ok || failure === undefined) return result;
  return { ok: false, error: { kind: failure } };
}

/** Credits belong to original work; abort is only a stop request. No wait queue. */
export class CallCredits {
  private readonly calls = new Set<OriginalCall>();
  private offers = 0;
  private ordinary = 0;
  private sources = 0;
  private closed = false;
  private closing: Promise<void> | undefined;

  private full(kind: 'offer' | 'ordinary' | 'source'): boolean {
    if (this.closed) return true;
    if (kind === 'offer') return this.offers >= 2;
    return this.ordinary >= 8 || (kind === 'source' && this.sources >= 2);
  }

  private count(kind: 'offer' | 'ordinary' | 'source', delta: number): void {
    if (kind === 'offer') this.offers += delta;
    else this.ordinary += delta;
    if (kind === 'source') this.sources += delta;
  }

  async run<T>(kind: 'offer' | 'ordinary' | 'source', caller: AbortSignal | undefined,
    work: (call: OriginalCall) => Promise<ClientResult<T>>): Promise<ClientResult<T>> {
    if (this.full(kind)) {
      return { ok: false, error: { kind: 'transport' } };
    }
    const call = original(kind === 'offer');
    this.calls.add(call);
    this.count(kind, 1);
    try {
      call.start(caller);
      if (call.signal.aborted) return { ok: false, error: { kind: 'cancelled' } };
      const result = await work(call);
      return settledResult(result, call.failure());
    } catch {
      return { ok: false, error: { kind: call.failure() ?? 'transport' } };
    } finally {
      this.calls.delete(call);
      this.count(kind, -1);
      call.finish();
    }
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    const calls = [...this.calls];
    this.closing = Promise.all(calls.map(call => call.done)).then(() => undefined);
    for (const call of calls) call.abort();
    return this.closing;
  }
}
