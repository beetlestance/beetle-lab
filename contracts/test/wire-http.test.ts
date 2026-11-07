import { expect, it, vi } from 'vitest';
import { createWireTransport } from '../src/wire-http.js';
import { validate } from '../src/validate.js';
import type { ProtocolTypes, ProtocolError } from '../src/generated/types.js';
import { fixture } from './fixtures.js';

const baseUrl = 'http://wire.synthetic.invalid';
const registry = { pathPrefix: '/api/v2/' as const, validate,
  validateError: (input: unknown) => validate('ProtocolError', input) };

it('uses one safe transport kernel with a fixed API namespace and typed registry', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(await fixture('valid/capabilities.json')));
  const transport = createWireTransport<ProtocolTypes, ProtocolError>({ baseUrl, fetch: fetcher }, registry);
  const result = await transport.json({ method: 'GET', path: '/api/v2/synthetic', response: 'Capabilities', successStatus: 200 });
  expect(result.ok).toBe(true);
  for (const path of ['/runner/v1/capabilities', '/api/v2/../../runner/v1/capabilities', '//other.invalid/api/v2/data']) {
    expect(await transport.json({ method: 'GET', path, response: 'Capabilities', successStatus: 200 })).toEqual({
      ok: false, error: { kind: 'request' },
    });
  }
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('enforces a pre-header deadline even when an injected fetch ignores abort', async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => undefined));
  const transport = createWireTransport<ProtocolTypes, ProtocolError>({ baseUrl, fetch: fetcher, timeoutMs: 5 }, registry);
  expect(await transport.json({ method: 'GET', path: '/api/v2/synthetic', response: 'Capabilities', successStatus: 200 }))
    .toEqual({ ok: false, error: { kind: 'timeout' } });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('cancels a late response body without waiting for its cleanup to settle', async () => {
  let release: ((response: Response) => void) | undefined;
  const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise(resolve => { release = resolve; }));
  const transport = createWireTransport<ProtocolTypes, ProtocolError>({ baseUrl, fetch: fetcher, timeoutMs: 5 }, registry);
  expect(await transport.json({ method: 'GET', path: '/api/v2/synthetic', response: 'Capabilities', successStatus: 200 }))
    .toEqual({ ok: false, error: { kind: 'timeout' } });
  const cancel = vi.fn(() => new Promise<void>(() => undefined));
  release?.(new Response(new ReadableStream<Uint8Array>({ cancel })));
  await Promise.resolve(); await Promise.resolve();
  expect(cancel).toHaveBeenCalledTimes(1);
});

it('never echoes a malformed configured base URL', () => {
  let error: unknown;
  try { createWireTransport<ProtocolTypes, ProtocolError>({ baseUrl: 'SYNTHETIC_URL_CANARY' }, registry); } catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(Error);
  expect(String(error)).not.toContain('SYNTHETIC_URL_CANARY');
});
