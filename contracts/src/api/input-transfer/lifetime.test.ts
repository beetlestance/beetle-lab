import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InputTransferClient } from '../input-transfer-types.js';
import { createInputTransferClient } from './index.js';
import { binary, deferred, emptyHash, record, turns } from './fixtures.test-support.js';

const baseUrl = 'https://fixture.invalid';
afterEach(() => vi.restoreAllMocks());
describe('operation originals and close custody', () => {
  it('retains two unresolved fetch originals after caller abort, refusing a third without fetch', async () => {
    const replies = [deferred<Response>(), deferred<Response>()];
    const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(() => replies[0]!.promise).mockImplementationOnce(() => replies[1]!.promise);
    const client = createInputTransferClient({ baseUrl, fetch: fetcher });
    const caller = new AbortController();
    const first = client.download({ record: record(), signal: caller.signal });
    const second = client.download({ record: record() });
    caller.abort(); await turns();
    expect(await client.download({ record: record() })).toEqual({ ok: false, issued: false, error: { kind: 'busy' } });
    expect(fetcher).toHaveBeenCalledTimes(2);
    let closed = false; const close = client.close().then(() => { closed = true; });
    await turns(); expect(closed).toBe(false);
    for (const reply of replies) reply.resolve(binary(new Uint8Array()));
    expect(await first).toMatchObject({ ok: false, issued: true, error: { kind: 'cancelled' } });
    expect(await second).toMatchObject({ ok: false, issued: true, error: { kind: 'cancelled' } });
    await close; expect(closed).toBe(true);
    expect(await client.download({ record: record() })).toEqual({ ok: false, issued: false, error: { kind: 'closed' } });
  });
  it('retains late-response body cancellation and the cached reentrant close promise', async () => {
    const reply = deferred<Response>(); const cancel = deferred<void>();
    let reentrant: Promise<void> | undefined;
    const stream = new ReadableStream<Uint8Array>({ cancel() { reentrant = client.close(); return cancel.promise; } });
    const client = createInputTransferClient({ baseUrl, fetch: () => reply.promise });
    const result = client.download({ record: record() });
    const close = client.close(); expect(client.close()).toBe(close);
    reply.resolve(new Response(stream)); await turns();
    expect(reentrant).toBe(close);
    let done = false; void close.then(() => { done = true; });
    await turns(); expect(done).toBe(false);
    cancel.resolve(); expect(await result).toMatchObject({ ok: false, issued: true }); await close;
  });
  it('retains a fetch that reenters close before returning its original promise', async () => {
    const reply = deferred<Response>(); let close!: Promise<void>;
    const client: InputTransferClient = createInputTransferClient({ baseUrl, fetch: () => { close = client.close(); return reply.promise; } });
    const result = client.download({ record: record() });
    let done = false; void close.then(() => { done = true; }); await turns(); expect(done).toBe(false);
    reply.resolve(binary(new Uint8Array())); await result; await close;
  });
  it('retains simultaneous original read and cancel until both settle', async () => {
    const read = deferred<Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>['read']>>>(); const cancel = deferred<void>();
    const response = binary(new Uint8Array());
    const reader = response.body!.getReader(); reader.releaseLock();
    const readMock = vi.spyOn(reader, 'read').mockImplementation(() => read.promise);
    const cancelMock = vi.spyOn(reader, 'cancel').mockImplementation(() => cancel.promise);
    vi.spyOn(response.body!, 'getReader').mockReturnValue(reader);
    const client = createInputTransferClient({ baseUrl, fetch: async () => response });
    const result = client.download({ record: record() }); await turns(); expect(readMock).toHaveBeenCalledTimes(1);
    const close = client.close(); expect(cancelMock).toHaveBeenCalledTimes(1);
    let settled = false; void close.then(() => { settled = true; });
    cancel.resolve(); await turns(); expect(settled).toBe(false);
    read.resolve({ done: true, value: undefined });
    expect(await result).toMatchObject({ ok: false, issued: true, error: { kind: 'cancelled' } }); await close;
    expect(cancelMock).toHaveBeenCalledTimes(1);
  });
  it('retains native digest work through abort/close and never returns aborted bytes', async () => {
    const hash = deferred<ArrayBuffer>(); const entered = deferred<void>();
    vi.spyOn(crypto.subtle, 'digest').mockImplementation(() => { entered.resolve(); return hash.promise; });
    const client = createInputTransferClient({ baseUrl, fetch: async () => binary(new Uint8Array()) });
    const result = client.download({ record: record() }); await entered.promise;
    const close = client.close(); let done = false; void close.then(() => { done = true; });
    await turns(); expect(done).toBe(false);
    hash.resolve(new Uint8Array(emptyHash.match(/../g)!.map(value => parseInt(value, 16))).buffer);
    expect(await result).toMatchObject({ ok: false, issued: true, error: { kind: 'cancelled' } }); await close;
  });
  it.each(['read', 'digest'] as const)('retains a reentrant %s original before its promise returns', async phase => {
    const held = deferred<ArrayBuffer>();
    const read = deferred<Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>['read']>>>();
    const entered = deferred<void>(); let close!: Promise<void>;
    const response = binary(new Uint8Array());
    const client = createInputTransferClient({ baseUrl, fetch: async () => response });
    if (phase === 'read') {
      const reader = response.body!.getReader(); reader.releaseLock();
      vi.spyOn(reader, 'read').mockImplementation(() => { close = client.close(); entered.resolve(); return read.promise; });
      vi.spyOn(reader, 'cancel').mockResolvedValue(undefined);
      vi.spyOn(response.body!, 'getReader').mockReturnValue(reader);
    } else {
      vi.spyOn(crypto.subtle, 'digest').mockImplementation(() => { close = client.close(); entered.resolve(); return held.promise; });
    }
    const result = client.download({ record: record() }); await entered.promise;
    let done = false; void close.then(() => { done = true; }); await turns(); expect(done).toBe(false);
    if (phase === 'read') read.resolve({ done: true, value: undefined }); else held.resolve(new ArrayBuffer(32));
    expect(await result).toMatchObject({ ok: false, issued: true, error: { kind: 'cancelled' } }); await close;
  });
  it('reports cleanup failure after every other original drains', async () => {
    const held = deferred<Response>(); const cancel = deferred<void>();
    const stream = new ReadableStream<Uint8Array>({ cancel: () => cancel.promise });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(stream)).mockImplementationOnce(() => held.promise);
    const client = createInputTransferClient({ baseUrl, fetch: fetcher });
    const first = client.download({ record: record() }); const second = client.download({ record: record() });
    await turns(); const close = client.close(); const rejected = expect(close).rejects.toThrow('Input transfer cleanup failed');
    cancel.reject(new Error('private cleanup')); await turns();
    expect(await first).toMatchObject({ ok: false, error: { kind: 'cancelled' } });
    let finished = false; void close.catch(() => { finished = true; }); await turns(); expect(finished).toBe(false);
    held.resolve(binary(new Uint8Array())); await second; await rejected;
  });
  it('preserves timeout attribution through a held fetch and skips already-aborted callers', async () => {
    vi.useFakeTimers();
    const held = deferred<Response>(); const fetcher = vi.fn<typeof fetch>(() => held.promise);
    const client = createInputTransferClient({ baseUrl, fetch: fetcher, timeoutMs: 1 });
    try {
      const caller = new AbortController(); caller.abort();
      expect(await client.download({ record: record(), signal: caller.signal })).toMatchObject({ ok: false, issued: false, error: { kind: 'cancelled' } });
      const result = client.download({ record: record() }); await vi.advanceTimersByTimeAsync(1);
      let done = false; void result.then(() => { done = true; }); await turns(); expect(done).toBe(false);
      const close = client.close(); held.resolve(binary(new Uint8Array()));
      expect(await result).toMatchObject({ ok: false, issued: true, error: { kind: 'timeout' } });
      expect(fetcher).toHaveBeenCalledTimes(1); await close;
    } finally { vi.useRealTimers(); }
  });
});
