import { describe, expect, it, vi } from 'vitest';
import { createInputTransferClient } from './index.js';
import { binary, emptyHash, record, sha256 } from './fixtures.test-support.js';

const baseUrl = 'https://fixture.invalid';
describe('bounded full downloads', () => {
  it.each([new Uint8Array(), new TextEncoder().encode('héllo 🌎'), new Uint8Array(8_388_608).fill(42)])('verifies empty, UTF8 and maximum payload through native SHA256', async body => {
    const hash = await sha256(body);
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      expect(init).toMatchObject({ method: 'GET', redirect: 'error', credentials: 'same-origin' });
      expect(init?.headers).not.toHaveProperty('range');
      return binary(body, hash);
    });
    const client = createInputTransferClient({ baseUrl, fetch: fetcher });
    expect(await client.download({ record: record({ bytes: body.length, offset: body.length, sha256: hash }) })).toEqual({ ok: true, value: body });
    expect(fetcher).toHaveBeenCalledTimes(1); await client.close();
  });
  it('accepts an empty null body with zero framing and native digest', async () => {
    const client = createInputTransferClient({ baseUrl, fetch: async () => new Response(null, { headers: {
      'content-type': 'application/octet-stream', etag: `"${emptyHash}"`, 'content-length': '0',
    } }) });
    expect(await client.download({ record: record() })).toEqual({ ok: true, value: new Uint8Array() });
    await client.close();
  });
  it.each([
    { 'content-type': 'text/plain' }, { etag: `W/"${emptyHash}"` }, { etag: `"${'a'.repeat(64)}"` },
    { 'content-encoding': 'gzip' }, { 'content-length': '1' }, { 'content-range': 'bytes 0-0/1' },
  ])('rejects incorrect headers %j', async headers => {
    const client = createInputTransferClient({ baseUrl, fetch: async () => binary(new Uint8Array(), emptyHash, headers) });
    expect(await client.download({ record: record() })).toMatchObject({ ok: false, issued: true, error: { kind: 'response' } });
    await client.close();
  });
  it('requires nonempty framing to omit Content-Length', async () => {
    const body = new Uint8Array([1]); const hash = await sha256(body);
    const client = createInputTransferClient({ baseUrl, fetch: async () => binary(body, hash, { 'content-length': '1' }) });
    expect(await client.download({ record: record({ bytes: 1, offset: 1, sha256: hash }) })).toMatchObject({ ok: false });
    await client.close();
  });
  it.each(['truncated', 'excess', 'wrong-hash', 'late-stream-error', 'partial-status'])('rejects %s completion', async fault => {
    const bytes = new Uint8Array([1, 2]); const hash = await sha256(bytes);
    const client = createInputTransferClient({ baseUrl, fetch: async () => {
      if (fault === 'late-stream-error') {
        let read = 0;
        return new Response(new ReadableStream({ pull(controller) {
          if (read++ === 0) controller.enqueue(bytes); else controller.error(new Error('private failure'));
        } }), { headers: { 'content-type': 'application/octet-stream', etag: `"${hash}"` } });
      }
      if (fault === 'partial-status') return new Response(bytes, { status: 206 });
      return binary(fault === 'truncated' ? bytes.subarray(0, 1) : fault === 'excess' ? new Uint8Array([1, 2, 3]) : new Uint8Array([3, 4]), hash);
    } });
    const result = await client.download({ record: record({ bytes: 2, offset: 2, sha256: hash }) });
    expect(result).toMatchObject({ ok: false, issued: true, error: { kind: 'response' } });
    expect(JSON.stringify(result)).not.toContain('private');
    if (fault === 'late-stream-error') await expect(client.close()).rejects.toThrow('Input transfer cleanup failed');
    else await client.close();
  });
  it('fails integrity when native crypto is absent', async () => {
    const original = globalThis.crypto;
    vi.stubGlobal('crypto', undefined);
    const client = createInputTransferClient({ baseUrl, fetch: async () => binary(new Uint8Array()) });
    try { expect(await client.download({ record: record() })).toMatchObject({ ok: false, error: { kind: 'response' } }); }
    finally { vi.stubGlobal('crypto', original); await client.close(); }
  });
});
