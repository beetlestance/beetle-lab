import { describe, expect, it, vi } from 'vitest';
import type { InputTransferOptions } from '../input-transfer-types.js';
import { createInputTransferClient } from './index.js';
import { json, record } from './fixtures.test-support.js';

describe('strict configuration and error JSON', () => {
  it.each(['https://user:pass@fixture.invalid', 'https://fixture.invalid/path', 'https://fixture.invalid/?q=x',
    'https://fixture.invalid/#fragment', 'https://fixture.invalid?', 'file:///tmp/test', 'x'.repeat(2049)])('rejects unsafe URL %s', baseUrl => {
    expect(() => createInputTransferClient({ baseUrl })).toThrow('Invalid transfer options');
  });
  it.each(['Range', 'If-Match', 'if-range', 'Content-Type', 'Content-Length', 'Content-Encoding', 'Host', 'Connection', 'Transfer-Encoding', 'Bad Name'])('rejects reserved header %s', name => {
    expect(() => createInputTransferClient({ baseUrl: 'https://fixture.invalid', headers: { [name]: 'x' } })).toThrow();
  });
  it('rejects getters and bounded invalid options without running accessors', () => {
    const getter = vi.fn();
    const inputs = [Object.defineProperty({}, 'baseUrl', { get: getter }),
      { baseUrl: 'https://fixture.invalid', headers: Object.defineProperty({}, 'X-Key', { get: getter }) },
      { baseUrl: 'https://fixture.invalid', timeoutMs: 0 }, { baseUrl: 'https://fixture.invalid', extra: true },
      { baseUrl: 'https://fixture.invalid', headers: { 'X-Key': 'x\r\ny' } },
      { baseUrl: 'https://fixture.invalid', headers: { 'X-Key': 'x'.repeat(2049) } },
      { baseUrl: 'https://fixture.invalid', headers: Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`X-${i}`, 'x'])) },
      { baseUrl: 'https://fixture.invalid', headers: Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`X-${i}`, 'x'.repeat(2048)])) }];
    for (const input of inputs) expect(() => createInputTransferClient(input as InputTransferOptions)).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });
  it('snapshots session headers and rejects invalid signals without issue', async () => {
    const headers = { 'X-Session': 'original' };
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      expect(init?.headers).toEqual({ 'x-session': 'original' });
      return new Response(null, { headers: { 'content-type': 'application/octet-stream', etag: `"${record().sha256}"` } });
    });
    const client = createInputTransferClient({ baseUrl: 'https://fixture.invalid', headers, fetch: fetcher });
    headers['X-Session'] = 'mutated';
    expect(await client.download({ record: record(), signal: {} as AbortSignal })).toMatchObject({ ok: false, issued: false, error: { kind: 'request' } });
    expect(fetcher).not.toHaveBeenCalled();
    expect(await client.download({ record: record() })).toMatchObject({ ok: true }); await client.close();
  });
  it('returns only validated errors and never exposes arbitrary response text', async () => {
    const error = { code: 'not_found', message: 'Resource not found', retryable: false, requestId: record().id, fields: [] };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json(error, 404))
      .mockResolvedValueOnce(json({ ...error, message: 'secret' }, 404))
      .mockResolvedValueOnce(new Response('secret'.repeat(11_000), { status: 400, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([0xff]), { status: 400, headers: { 'content-type': 'application/json' } }));
    const client = createInputTransferClient({ baseUrl: 'https://fixture.invalid', fetch: fetcher });
    expect(await client.download({ record: record() })).toEqual({ ok: false, issued: true, error: { kind: 'protocol', status: 404, protocol: error } });
    for (let i = 0; i < 3; i++) {
      const result = await client.download({ record: record() });
      expect(result).toMatchObject({ ok: false, issued: true, error: { kind: 'response' } });
      expect(JSON.stringify(result)).not.toContain('secret');
    }
    expect(fetcher).toHaveBeenCalledTimes(4); await client.close();
  });
});
