import { expect, it } from 'vitest';
import type { ServerResponse } from 'node:http';
import { createApiServer } from '../../../src/adapters/inbound/http/api-errors.js';
import { RequestLifetimes } from '../../../src/adapters/inbound/http/request-lifetimes/index.js';
import { deferred } from '../../run-comparison/fixture.js';

it('does not retain an HTTP slot when the response closes during authorization before owner allocation', async () => {
  const authorized = deferred<void>(); const entered = deferred<ServerResponse>();
  const server = createApiServer(); const owners = new RequestLifetimes(1); let calls = 0;
  await server.register(async routes => {
    routes.addHook('onRequest', async (request, reply) => {
      if (request.headers['x-held-authorization'] === '1') { entered.resolve(reply.raw); await authorized.promise; }
    });
    owners.register(routes);
    routes.get('/read', async () => { calls++; return { ready: true }; });
  });
  await server.listen({ host: '127.0.0.1', port: 0 });
  const address = server.server.address(); if (!address || typeof address === 'string') throw Error('Missing listener');
  const url = `http://127.0.0.1:${address.port}/read`; const controller = new AbortController();
  try {
    const first = fetch(url, { headers: { 'x-held-authorization': '1' }, signal: controller.signal });
    const reply = await entered.promise;
    const closed = new Promise<void>(resolve => reply.once('close', resolve));
    controller.abort(); await expect(first).rejects.toThrow(); await closed;
    expect(reply.destroyed).toBe(true);
    authorized.resolve(); await new Promise<void>(resolve => setImmediate(resolve));
    const next = await fetch(url); expect(next.status).toBe(200);
    expect(await next.json()).toEqual({ ready: true }); expect(calls).toBe(1);
  } finally { authorized.resolve(); await owners.close(); await server.close(); }
});

it('accepts healthy completed GET and POST request messages without confusing body EOF with response closure', async () => {
  const server = createApiServer(); const owners = new RequestLifetimes(1); const completed: boolean[] = [];
  await server.register(async routes => {
    routes.addHook('onRequest', async request => {
      for (let turn = 0; turn < 10 && !request.raw.complete; turn++) await new Promise<void>(resolve => setImmediate(resolve));
      completed.push(request.raw.complete);
    });
    owners.register(routes);
    routes.route({ method: ['GET', 'POST'], url: '/read', handler: async request =>
      owners.forRequest(request).run(async () => ({ ready: true, ...(request.method === 'POST' ? { body: request.body } : {}) })),
    });
  });
  await server.listen({ host: '127.0.0.1', port: 0 });
  const address = server.server.address(); if (!address || typeof address === 'string') throw Error('Missing listener');
  const url = `http://127.0.0.1:${address.port}/read`;
  try {
    const get = await fetch(url); expect(get.status).toBe(200); expect(await get.json()).toEqual({ ready: true });
    const post = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"value":1}' });
    expect(post.status).toBe(200); expect(await post.json()).toEqual({ ready: true, body: { value: 1 } });
    expect(completed).toEqual([true, true]);
  } finally { await owners.close(); await server.close(); }
});
