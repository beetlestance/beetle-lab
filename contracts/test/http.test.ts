import { expect, expectTypeOf, it, vi } from 'vitest';
import { createHttpTransport, createRunnerClient, validate } from '../src/index.js';
import type { Offer, ProtocolTypes, ProtocolName } from '../src/index.js';
import { fixture } from './fixtures.js';

async function valid<N extends ProtocolName>(name: N, path: string): Promise<ProtocolTypes[N]> {
  const checked = validate(name, await fixture(`valid/${path}.json`));
  if (!checked.ok) throw new Error('invalid test fixture');
  return checked.value;
}
const baseUrl = 'http://w01.synthetic.invalid';
const attemptId = (await valid('AttemptSnapshot', 'snapshot')).attemptId;
function client(fetcher: typeof fetch, options: { maximumBytes?: number; timeoutMs?: number } = {}) {
  return createRunnerClient(createHttpTransport({ baseUrl, fetch: fetcher, ...options }));
}

it('generates typed requests and validates the unchanged response', async () => {
  const snapshot = await valid('AttemptSnapshot', 'snapshot');
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(snapshot, { status: 202 }));
  const offer = await valid('Offer', 'offer');
  const copy = structuredClone(offer);
  const result = await client(fetcher).offer(offer.attemptId, offer);
  expect(result).toEqual({ ok: true, value: snapshot });
  expect(offer).toEqual(copy);
  expect(fetcher.mock.calls[0]?.[0]?.toString()).toBe(`${baseUrl}/runner/v1/attempts/${offer.attemptId}`);
  const options = fetcher.mock.calls[0]?.[1];
  expect(options?.method).toBe('PUT');
  expect(JSON.parse(options?.body as string)).toEqual(offer);
  expectTypeOf<Offer['budget']['cpuMillis']>().toEqualTypeOf<number>();
  if (result.ok) expectTypeOf(result.value.generation).toEqualTypeOf<number>();
});

it('generates all scoped JSON routes and cursor queries', async () => {
  const snapshot = await valid('AttemptSnapshot', 'snapshot');
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(snapshot));
  const runner = client(fetcher);
  await runner.snapshot(snapshot.attemptId);
  await runner.cancel(snapshot.attemptId, await valid('Cancellation', 'cancel'));
  await runner.ack(snapshot.attemptId, await valid('Ack', 'ack'));
  await runner.events(snapshot.attemptId, 7);
  await runner.capabilities();
  expect(fetcher.mock.calls.map(call => new URL(String(call[0])).pathname + new URL(String(call[0])).search)).toEqual([
    `/runner/v1/attempts/${snapshot.attemptId}`, `/runner/v1/attempts/${snapshot.attemptId}/cancel`,
    `/runner/v1/attempts/${snapshot.attemptId}/ack`, `/runner/v1/attempts/${snapshot.attemptId}/events?after=7`,
    '/runner/v1/capabilities',
  ]);
});

it('does not send structurally invalid or oversized requests', async () => {
  const fetcher = vi.fn<typeof fetch>();
  const offer = await valid('Offer', 'offer');
  expect((await client(fetcher).offer(offer.attemptId, { ...offer, dockerFlags: [] } as Offer)).ok).toBe(false);
  const result = await client(fetcher, { maximumBytes: 32 }).offer(offer.attemptId, offer);
  expect(result).toEqual({ ok: false, error: { kind: 'request' } });
  expect(fetcher).not.toHaveBeenCalled();
});

it('validates typed error replies and never returns untrusted error bodies', async () => {
  const error = await fixture('valid/cursor-expired.json');
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(error, { status: 409 }))
    .mockResolvedValueOnce(Response.json({ message: 'synthetic-secret-canary' }, { status: 500 }));
  const first = await client(fetcher).events(attemptId, 0);
  expect(first.ok).toBe(false);
  if (!first.ok) expect(first.error.kind).toBe('protocol');
  const second = await client(fetcher).events(attemptId, 0);
  expect(second.ok).toBe(false);
  expect(JSON.stringify(second)).not.toContain('canary');
});

it('rejects malformed successful replies and bounded response overflow', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ exitCode: 0 }))
    .mockResolvedValueOnce(new Response('x'.repeat(100)));
  expect((await client(fetcher).snapshot(attemptId)).ok).toBe(false);
  expect(await client(fetcher, { maximumBytes: 32 }).snapshot(attemptId)).toEqual({
    ok: false, error: { kind: 'response', status: 200 },
  });
});

it('passes cancellation and a finite deadline and never retries transport failures', async () => {
  const controller = new AbortController(); controller.abort();
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    if (init?.signal?.aborted) throw new Error('synthetic abort');
    throw new Error('synthetic-secret-canary');
  });
  expect(await client(fetcher).capabilities(controller.signal)).toEqual({ ok: false, error: { kind: 'cancelled' } });
  expect(await client(fetcher).capabilities()).toEqual({ ok: false, error: { kind: 'transport' } });
  expect(fetcher).toHaveBeenCalledTimes(2);
  const timeoutFetch = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('deadline')), { once: true });
  }));
  expect(await client(timeoutFetch, { timeoutMs: 5 }).capabilities()).toEqual({ ok: false, error: { kind: 'timeout' } });
  expect(timeoutFetch).toHaveBeenCalledTimes(1);
});

it('rejects invalid byte and deadline budgets at construction', () => {
  for (const maximumBytes of [0, -1, 1.5, Infinity, 16_777_217]) {
    expect(() => createHttpTransport({ baseUrl, maximumBytes })).toThrow();
  }
  for (const timeoutMs of [0, -1, 1.5, Infinity, 300_001]) {
    expect(() => createHttpTransport({ baseUrl, timeoutMs })).toThrow();
  }
});


it('never forwards private headers to an injected origin or non-runner path', async () => {
  const fetcher = vi.fn<typeof fetch>();
  const transport = createHttpTransport({ baseUrl, fetch: fetcher, headers: { authorization: 'synthetic-private' } });
  for (const path of ['https://other.synthetic.invalid/runner/v1/capabilities', '//other.synthetic.invalid/runner/v1/capabilities',
    '/other', '/runner/v1/../../other', '/runner/v1/capabilities#fragment', '/runner/v1/' + 'x'.repeat(2048)]) {
    expect(await transport.json({ method: 'GET', path, response: 'Capabilities', successStatus: 200 })).toEqual({
      ok: false, error: { kind: 'request' },
    });
  }
  expect(fetcher).not.toHaveBeenCalled();
});

it('rejects an unexpected success status', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(await fixture('valid/snapshot.json')));
  const offer = await valid('Offer', 'offer');
  expect(await client(fetcher).offer(offer.attemptId, offer)).toEqual({ ok: false, error: { kind: 'response', status: 200 } });
});
