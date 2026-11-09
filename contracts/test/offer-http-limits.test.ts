import { expect, it, vi } from 'vitest';
import { createHttpTransport, createRunnerClient } from '../src/index.js';
import type { Offer } from '../src/index.js';
import { createWireTransport } from '../src/wire-http.js';
import { fixture } from './fixtures.js';

const original = await fixture('valid/offer.json') as Offer;
const snapshot = await fixture('valid/snapshot.json');
const config = { value: 'é'.repeat(524_282) };
const offer = { ...original, config };
const baseUrl = 'http://runner-limit.synthetic.invalid';

it('sends full-size config once while retaining the original one MiB response bound', async () => {
  expect(Buffer.byteLength(JSON.stringify(config))).toBe(1_048_576);
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(snapshot, { status: 202 }))
    .mockResolvedValueOnce(new Response(' '.repeat(1_048_577) + JSON.stringify(snapshot), { status: 202 }));
  const client = createRunnerClient(createHttpTransport({ baseUrl, fetch: fetcher }));
  expect(await client.offer(offer.attemptId, offer)).toEqual({ ok: true, value: snapshot });
  const sent = fetcher.mock.calls[0]?.[1]?.body;
  expect(typeof sent).toBe('string');
  expect(Buffer.byteLength(sent as string)).toBeGreaterThan(1_048_576);
  expect(JSON.parse(sent as string)).toEqual(offer);
  expect(await client.offer(offer.attemptId, offer)).toEqual({ ok: false, error: { kind: 'response', status: 202 } });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('preserves a smaller caller request allowance and rejects config growth before fetch', async () => {
  const fetcher = vi.fn<typeof fetch>();
  const limited = createRunnerClient(createHttpTransport({ baseUrl, fetch: fetcher, maximumBytes: 1_048_576 }));
  expect(await limited.offer(offer.attemptId, offer)).toEqual({ ok: false, error: { kind: 'request' } });
  const normal = createRunnerClient(createHttpTransport({ baseUrl, fetch: fetcher }));
  expect((await normal.offer(offer.attemptId, { ...offer, config: { value: config.value + 'x' } })).ok).toBe(false);
  expect(fetcher).not.toHaveBeenCalled();
});

it('isolates shipped per-request overrides from other messages and subsequent mutation', async () => {
  const requestMaximumBytes = { Large: 2048 };
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}));
  const transport = createWireTransport<{ Large: unknown; Small: unknown; Reply: unknown }, never>({ baseUrl, fetch: fetcher,
    maximumBytes: 1024 }, { pathPrefix: '/runner/v1/', requestMaximumBytes,
    validate: (_name, value) => ({ ok: true, value }), validateError: () => ({ ok: false, issues: [] }) });
  requestMaximumBytes.Large = 1;
  const call = { method: 'POST', path: '/runner/v1/test', response: 'Reply' as const, successStatus: 200, body: { text: 'a'.repeat(100) } };
  expect((await transport.json({ ...call, request: 'Large' })).ok).toBe(true);
  expect((await transport.json({ ...call, request: 'Small', body: { text: 'a'.repeat(1100) } })).ok).toBe(false);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('captures the caller byte limit once before sending a request', async () => {
  let reads = 0;
  const fetcher = vi.fn<typeof fetch>();
  const client = createRunnerClient(createHttpTransport({ baseUrl, fetch: fetcher,
    get maximumBytes() { return ++reads === 1 ? 32 : 2_097_152; } }));
  expect(await client.offer(offer.attemptId, offer)).toEqual({ ok: false, error: { kind: 'request' } });
  expect(reads).toBe(1);
  expect(fetcher).not.toHaveBeenCalled();
});
