import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInputTransferClient } from './index.js';
import { binary, deferred, emptyHash, record, sha256, turns } from './fixtures.test-support.js';

const baseUrl = 'https://fixture.invalid';
afterEach(() => vi.restoreAllMocks());
describe('bounded file preparation shares transfer ownership', () => {
  it.each([new Uint8Array(), new TextEncoder().encode('héllo 🌎'), new Uint8Array(8_388_608).fill(37)])('returns native hash and exact caller-owned bytes without fetch', async content => {
    const fetcher = vi.fn<typeof fetch>();
    const client = createInputTransferClient({ baseUrl, fetch: fetcher });
    const result = await client.prepare({ file: new Blob([content]) });
    expect(result).toEqual({ ok: true, value: { content, sha256: await sha256(content) } });
    expect(fetcher).not.toHaveBeenCalled(); await client.close();
  });
  it('rejects oversize, forged Blob, request getters and extras before native read', async () => {
    const read = vi.spyOn(Blob.prototype, 'arrayBuffer'); const getter = vi.fn();
    const client = createInputTransferClient({ baseUrl, fetch: vi.fn<typeof fetch>() });
    const requests = [{ file: new Blob([new Uint8Array(8_388_609)]) }, { file: Object.create(Blob.prototype) },
      Object.defineProperty({}, 'file', { get: getter }), { file: new Blob([]), extra: true }];
    for (const request of requests) expect(await client.prepare(request as Parameters<typeof client.prepare>[0])).toMatchObject({ ok: false, issued: false, error: { kind: 'request' } });
    expect(read).not.toHaveBeenCalled(); expect(getter).not.toHaveBeenCalled(); await client.close();
  });
  it('uses native size/read while ignoring replaceable instance methods', async () => {
    const file = new Blob(['fixture']); const getter = vi.fn(() => { throw new Error('getter'); });
    Object.defineProperty(file, 'size', { get: getter }); Object.defineProperty(file, 'arrayBuffer', { get: getter });
    const client = createInputTransferClient({ baseUrl });
    expect(await client.prepare({ file })).toMatchObject({ ok: true, value: { sha256: await sha256(new TextEncoder().encode('fixture')) } });
    expect(getter).not.toHaveBeenCalled(); await client.close();
  });
  it('retains a cancelled original Blob read and a fetch in the same two slots', async () => {
    const read = deferred<ArrayBuffer>(); const response = deferred<Response>();
    vi.spyOn(Blob.prototype, 'arrayBuffer').mockImplementation(() => read.promise);
    const fetcher = vi.fn<typeof fetch>(() => response.promise);
    const client = createInputTransferClient({ baseUrl, fetch: fetcher }); const caller = new AbortController();
    const prepared = client.prepare({ file: new Blob([]), signal: caller.signal });
    const downloaded = client.download({ record: record() }); caller.abort(); await turns();
    expect(await client.prepare({ file: new Blob([]) })).toEqual({ ok: false, issued: false, error: { kind: 'busy' } });
    expect(await client.download({ record: record() })).toMatchObject({ ok: false, issued: false, error: { kind: 'busy' } });
    const close = client.close(); let done = false; void close.then(() => { done = true; });
    response.resolve(binary(new Uint8Array())); await downloaded; await turns(); expect(done).toBe(false);
    read.resolve(new ArrayBuffer(0));
    expect(await prepared).toMatchObject({ ok: false, issued: false, error: { kind: 'cancelled' } });
    expect(fetcher).toHaveBeenCalledTimes(1); await close;
  });
  it.each(['read', 'digest'] as const)('retains a reentrant preparation %s until its original settles', async phase => {
    const held = deferred<ArrayBuffer>(); let close!: Promise<void>; const entered = deferred<void>();
    const client = createInputTransferClient({ baseUrl });
    const original = () => { close = client.close(); entered.resolve(); return held.promise; };
    if (phase === 'read') vi.spyOn(Blob.prototype, 'arrayBuffer').mockImplementation(original);
    else vi.spyOn(crypto.subtle, 'digest').mockImplementation(original);
    const result = client.prepare({ file: new Blob([]) }); await entered.promise;
    expect(client.close()).toBe(close);
    let done = false; void close.then(() => { done = true; }); await turns(); expect(done).toBe(false);
    held.resolve(new ArrayBuffer(phase === 'read' ? 0 : 32));
    expect(await result).toMatchObject({ ok: false, issued: false, error: { kind: 'cancelled' } }); await close;
  });
  it('checks actual buffer length and original failures without network issue', async () => {
    const read = vi.spyOn(Blob.prototype, 'arrayBuffer').mockResolvedValueOnce(new ArrayBuffer(1))
      .mockRejectedValueOnce(new Error('private read failure'));
    const fetcher = vi.fn<typeof fetch>(); const client = createInputTransferClient({ baseUrl, fetch: fetcher });
    for (let i = 0; i < 2; i++) {
      const result = await client.prepare({ file: new Blob([]) });
      expect(result).toMatchObject({ ok: false, issued: false, error: { kind: 'transport' } });
      expect(JSON.stringify(result)).not.toContain('private');
    }
    expect(read).toHaveBeenCalledTimes(2); expect(fetcher).not.toHaveBeenCalled(); await client.close();
  });
  it('keeps one deadline through native digest and attributes timeout before later close', async () => {
    vi.useFakeTimers(); const held = deferred<ArrayBuffer>(); const entered = deferred<void>();
    vi.spyOn(crypto.subtle, 'digest').mockImplementation(() => { entered.resolve(); return held.promise; });
    const client = createInputTransferClient({ baseUrl, timeoutMs: 1 });
    try {
      const result = client.prepare({ file: new Blob([]) }); await entered.promise;
      await vi.advanceTimersByTimeAsync(1); const close = client.close();
      held.resolve(new Uint8Array(emptyHash.match(/../g)!.map(value => parseInt(value, 16))).buffer);
      expect(await result).toMatchObject({ ok: false, issued: false, error: { kind: 'timeout' } }); await close;
    } finally { vi.useRealTimers(); }
  });
});
