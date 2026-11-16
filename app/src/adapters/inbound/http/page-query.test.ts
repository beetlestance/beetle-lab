import Fastify from 'fastify';
import { afterEach, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { encodeJson } from '@beetle/contracts';
import { apiMessageSchemas, apiSchemas, validateApi } from '@beetle/contracts/api';
import type { PageQuery } from '@beetle/contracts/api';
import { configureSchemaCompilers } from './schema-compilers.js';
import { decodePageQuery } from './page-query.js';

const servers: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => server.close())); });
function server() {
  const app = Fastify({ logger: false, bodyLimit: 4096 }); servers.push(app);
  configureSchemaCompilers(app, { schemas: apiSchemas, encodeJson });
  const handler = vi.fn((query: PageQuery) => query);
  app.get<{ Querystring: PageQuery }>('/page', {
    // Decode this HTTP transport field before strict schema validation; never coerce JSON bodies.
    preValidation: async (request, reply) => {
      const decoded = decodePageQuery(request.query);
      if (!decoded.ok) return reply.code(400).send({ error: 'Invalid page query' });
      request.query = decoded.value;
    }, schema: { querystring: apiMessageSchemas.PageQuery, response: { 200: apiMessageSchemas.PageQuery } },
  }, async request => handler(request.query));
  app.post('/body', { schema: { body: apiMessageSchemas.PageQuery } }, async request => request.body);
  return { app, handler };
}

it('explicitly decodes canonical decimal query integers before strict Fastify validation', async () => {
  const { app, handler } = server();
  const response = await app.inject('/page?limit=25&cursor=opaque_A-1');
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ limit: 25, cursor: 'opaque_A-1' });
  expect(handler).toHaveBeenCalledWith({ limit: 25, cursor: 'opaque_A-1' });
  expect(validateApi('PageQuery', { limit: '25' }).ok).toBe(false);
  expect((await app.inject('/page?limit=1')).statusCode).toBe(200);
  expect((await app.inject('/page?limit=100')).statusCode).toBe(200);
});

it.each(['', '?limit=0', '?limit=101', '?limit=-1', '?limit=01', '?limit=1.0', '?limit=1e1', '?limit=%202', '?limit=2%20',
  '?limit=%2B2', '?limit=2&limit=3', '?limit=2&cursor=a&cursor=b', '?limit=2&extra=true', '?limit=2&cursor=bad%2Fcursor',
  '?limit=9999999999999999999999999999999999999999999999999999999', '?limit='])('rejects noncanonical, duplicate, out of range or unknown query fields: %s', async query => {
  const { app, handler } = server();
  expect((await app.inject(`/page${query}`)).statusCode).toBe(400);
  expect(handler).not.toHaveBeenCalled();
});

it('keeps JSON body validation numeric, strict and free of default or field removal', async () => {
  const { app } = server();
  expect((await app.inject({ method: 'POST', url: '/body', payload: { limit: '25' } })).statusCode).toBe(400);
  expect((await app.inject({ method: 'POST', url: '/body', payload: { limit: 25, extra: true } })).statusCode).toBe(400);
  expect((await app.inject({ method: 'POST', url: '/body', payload: {} })).statusCode).toBe(400);
  const response = await app.inject({ method: 'POST', url: '/body', payload: { limit: 25 } });
  expect(response.statusCode).toBe(200); expect(response.json()).toEqual({ limit: 25 });
});

it('does not mutate raw query values and bounds/rejects unsafe decoder input', () => {
  const raw = { limit: '25', extra: true };
  expect(decodePageQuery(raw)).toEqual({ ok: false }); expect(raw.limit).toBe('25');
  const getter = vi.fn(() => '25');
  expect(decodePageQuery(Object.defineProperty({}, 'limit', { get: getter, enumerable: true }))).toEqual({ ok: false });
  expect(getter).not.toHaveBeenCalled();
  for (const input of [{ limit: 25 }, { limit: ['1', '2'] }, { limit: '1', cursor: 'x'.repeat(5000) }, [], null]) {
    expect(decodePageQuery(input)).toEqual({ ok: false });
  }
});

it('keeps history enums exact and rejects duplicate or unknown HTTP fields without mutating input', async () => {
  const { decodeRunListQuery } = await import('./page-query.js');
  const raw = { limit: '2', state: 'finished', outcome: 'passed', order: 'oldest' };
  expect(decodeRunListQuery(raw)).toEqual({ ok: true, value: { ...raw, limit: 2 } });
  expect(raw.limit).toBe('2');
  expect(decodeRunListQuery({ limit: '2' })).toEqual({ ok: true, value: { limit: 2 } });
  for (const input of [{ ...raw, state: ['active', 'finished'] }, { ...raw, outcome: ['passed', 'failed'] },
    { ...raw, order: ['newest', 'oldest'] }, { ...raw, order: 'NEWEST' }, { ...raw, state: 'bogus' },
    { ...raw, extra: true }, { ...raw, limit: '01' }, { ...raw, limit: 2 }, { ...raw, cursor: 'a'.repeat(513) }]) {
    expect(decodeRunListQuery(input)).toEqual({ ok: false });
  }
});
