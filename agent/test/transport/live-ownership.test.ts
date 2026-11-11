import { expect, it, vi } from 'vitest';
import type { AgentHttpOptions } from '../../src/transport/index.js';
import type { LiveMetricRead } from '../../src/live-metrics/index.js';
import { frame } from '../live-metrics/fixtures.js';
import { deferred, sourceFixture } from './source-fixture.js';
const f = sourceFixture();
async function setup() {
  let value = frame();
  const read = vi.fn<NonNullable<AgentHttpOptions['liveMetrics']>>(async () => ({ok: true, frame: value}));
  const e = await f.server(false, read); value = frame({scope: e.key});
  return {...e, read, value, live: e.path.replace('/source', '/live-metrics')};
}
it('retains two timed-out originals without consuming source-transfer or control slots', async () => {
  const e = await setup(); const gate = deferred<LiveMetricRead>(); e.read.mockImplementation(() => gate.promise);
  const port = await f.listen(e.server);
  const clients = Array.from({length: 2}, () => {const c = f.raw(port, e.live, e.headers); c.client.end(); return c;});
  try {
    await expect.poll(() => e.read.mock.calls.length).toBe(2);
    await expect.poll(() => e.read.mock.calls.every(([, budget]) => budget.signal?.aborted), {timeout: 6500}).toBe(true);
    expect((await Promise.all(clients.map(client => client.response))).every(response => response.status === 0)).toBe(true);
    expect((await e.server.inject({url: e.live, headers: e.headers})).statusCode).toBe(429);
    expect((await e.server.inject({url: e.path, headers: e.headers})).statusCode).toBe(200);
    expect((await e.server.inject({url: '/runner/v1/capabilities', headers: e.headers})).statusCode).toBe(200);
    expect(e.read).toHaveBeenCalledTimes(2);
  } finally {gate.resolve({ok: true, frame: e.value});}
  await new Promise(resolve => setImmediate(resolve));
  e.read.mockResolvedValue({ok: true, frame: e.value});
  expect((await e.server.inject({url: e.live, headers: e.headers})).statusCode).toBe(200);
});
it('retains credits after service completion until actual response writes and socket close', async () => {
  const e = await setup(); const release = deferred<void>(); let responses = 0;
  e.server.addHook('onSend', async (request, reply, payload) => {
    if (request.url === e.live && reply.statusCode === 200) {responses++; await release.promise;} return payload;
  });
  const port = await f.listen(e.server);
  const clients = Array.from({length: 2}, () => {const c = f.raw(port, e.live, e.headers); c.client.end(); return c;});
  try {
    await expect.poll(() => responses).toBe(2);
    expect((await e.server.inject({url: e.live, headers: e.headers})).statusCode).toBe(429);
    expect((await e.server.inject({url: e.path, headers: e.headers})).statusCode).toBe(200);
  } finally {release.resolve();}
  expect((await Promise.all(clients.map(c => c.response))).every(response => response.status === 200)).toBe(true);
});
it('drains an ignored-abort live service before server shutdown', async () => {
  const e = await setup(); const gate = deferred<LiveMetricRead>(); e.read.mockImplementation(() => gate.promise);
  const port = await f.listen(e.server); const client = f.raw(port, e.live, e.headers); client.client.end();
  await expect.poll(() => e.read.mock.calls.length).toBe(1);
  client.client.destroy(); await client.response;
  await expect.poll(() => e.read.mock.calls[0]![1].signal?.aborted).toBe(true);
  let closed = false; const closing = e.server.close().then(() => {closed = true;});
  await new Promise(resolve => setImmediate(resolve)); expect(closed).toBe(false);
  gate.resolve({ok: true, frame: e.value}); await closing; expect(closed).toBe(true);
});

it('never issues a delayed handler after its pre-service socket disconnects', async () => {
  const e = await setup(); const entered = deferred<void>(); const release = deferred<void>(); const disconnected = deferred<void>();
  e.server.addHook('preHandler', async request => {
    if (request.url === e.live) {
      request.raw.socket.once('close', () => disconnected.resolve()); entered.resolve(); await release.promise;
    }
  });
  const port = await f.listen(e.server); const client = f.raw(port, e.live, e.headers); client.client.end();
  try {await entered.promise; client.client.destroy(); await client.response; await disconnected.promise;}
  finally {release.resolve();}
  await new Promise(resolve => setImmediate(resolve)); expect(e.read).not.toHaveBeenCalled();
});
