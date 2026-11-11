import { expect, it, vi } from 'vitest';
import { performance } from 'node:perf_hooks';
import type { AgentHttpOptions } from '../../src/transport/index.js';
import { frame } from '../live-metrics/fixtures.js';
import { sourceFixture } from './source-fixture.js';
const f = sourceFixture();
async function setup() {
  let value = frame();
  const read = vi.fn<NonNullable<AgentHttpOptions['liveMetrics']>>(async () => ({ok: true, frame: value}));
  const e = await f.server(false, read); value = frame({scope: e.key});
  return {...e, value, read, live: e.path.replace('/source', '/live-metrics')};
}
it('serves the bounded canonical snapshot with scoped authority, no-store and a five-second read budget', async () => {
  const e = await setup(); const started = performance.now();
  const response = await e.server.inject({url: e.live, headers: e.headers});
  expect(response.statusCode).toBe(200); expect(response.json()).toEqual(e.value);
  expect(Buffer.byteLength(response.body)).toBeLessThanOrEqual(65536);
  expect(response.headers).toMatchObject({'cache-control': 'no-store', connection: 'close'});
  expect(e.read).toHaveBeenCalledTimes(1);
  const [key, budget] = e.read.mock.calls[0]!;
  expect(key).toEqual(e.key); expect(budget.deadline).toBeGreaterThan(started);
  expect(budget.deadline).toBeLessThanOrEqual(performance.now() + 5000);
  expect(e.unused).not.toHaveBeenCalled();
});
it('rejects invalid identity, browser metadata, selectors and bodies before service effects', async () => {
  const e = await setup();
  const cases = [
    {headers: {...e.headers, authorization: 'Bearer invalid'}},
    {headers: {...e.headers, origin: 'https://synthetic.invalid'}},
    {headers: {...e.headers, 'x-beetle-journal-authority': '00000000-0000-4000-8000-000000000099'}},
    {headers: {...e.headers, 'x-beetle-generation': '2'}},
    {url: `${e.live}?path=secrets`},
    {headers: {...e.headers, 'content-length': '2'}, payload: '{}'},
  ];
  for (const test of cases) {
    const response = await e.server.inject({url: e.live, headers: e.headers, ...test});
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
  }
  expect(e.read).not.toHaveBeenCalled();
});
it('reports absent service, busy and unavailable reads without disclosing exceptions or changing attempts', async () => {
  const absent = await f.server();
  expect((await absent.server.inject({url: absent.path.replace('/source', '/live-metrics'), headers: absent.headers})).statusCode).toBe(503);
  const e = await setup();
  e.read.mockResolvedValueOnce({ok: false, reason: 'busy'}).mockResolvedValueOnce({ok: false, reason: 'stale'});
  expect((await e.server.inject({url: e.live, headers: e.headers})).statusCode).toBe(429);
  expect((await e.server.inject({url: e.live, headers: e.headers})).statusCode).toBe(503);
  expect(e.unused).not.toHaveBeenCalled();
});
it('rejects scope mismatch, invalid digest and hostile frame getters before encoding a response', async () => {
  const e = await setup();
  e.read.mockResolvedValueOnce({ok: true, frame: {...e.value, scope: {...e.key, generation: 2}}});
  e.read.mockResolvedValueOnce({ok: true, frame: {...e.value, subsetDigest: 'f'.repeat(64)}});
  const hostile = {...e.value}; Object.defineProperty(hostile, 'subset', {get() {throw new Error('PRIVATE_SENTINEL');}});
  e.read.mockResolvedValueOnce({ok: true, frame: hostile});
  for (let index = 0; index < 3; index++) {
    const response = await e.server.inject({url: e.live, headers: e.headers});
    expect(response.statusCode).toBe(503); expect(response.body).not.toContain('PRIVATE_SENTINEL');
    await new Promise(resolve => setImmediate(resolve));
  }
});
