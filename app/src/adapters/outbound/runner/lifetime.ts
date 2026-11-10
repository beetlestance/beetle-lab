import type { ClientResult } from '@beetle/contracts';

export interface OriginalCall {
  readonly signal: AbortSignal;
  readonly done: Promise<void>;
  readonly offer: boolean;
  failure(): 'cancelled' | 'timeout' | undefined;
  abort(): void;
  finish(): void;
}

function original(offer: boolean, caller?: AbortSignal): OriginalCall {
  const controller = new AbortController();
  let cause: 'cancelled' | 'timeout' | undefined;
  let complete!: () => void;
  const done = new Promise<void>(resolve => { complete = resolve; });
  const stop = (reason: 'cancelled' | 'timeout') => {
    if (cause) return;
    cause = reason;
    controller.abort();
  };
  const abort = () => stop('cancelled');
  caller?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => stop('timeout'), 5000);
  if (caller?.aborted) abort();
  return {
    offer, signal: controller.signal, done, failure: () => cause, abort,
    finish: () => { clearTimeout(timer); caller?.removeEventListener('abort', abort); complete(); },
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
  private closed = false;
  private closing: Promise<void> | undefined;

  async run<T>(offer: boolean, caller: AbortSignal | undefined,
    work: (call: OriginalCall) => Promise<ClientResult<T>>): Promise<ClientResult<T>> {
    if (this.closed || (offer ? this.offers >= 2 : this.ordinary >= 8)) {
      return { ok: false, error: { kind: 'transport' } };
    }
    const call = original(offer, caller);
    this.calls.add(call);
    if (offer) this.offers++;
    else this.ordinary++;
    try {
      if (call.signal.aborted) return { ok: false, error: { kind: 'cancelled' } };
      const result = await work(call);
      return settledResult(result, call.failure());
    } catch {
      return { ok: false, error: { kind: call.failure() ?? 'transport' } };
    } finally {
      this.calls.delete(call);
      if (offer) this.offers--;
      else this.ordinary--;
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
