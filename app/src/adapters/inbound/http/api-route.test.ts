import { Readable } from 'node:stream';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { afterEach, expect, it, vi } from 'vitest';
import { encodeJson } from '@beetle/contracts';
import { apiSchemas } from '@beetle/contracts/api';
import type { Organization } from '@beetle/contracts/api';
import { configureSchemaCompilers } from './schema-compilers.js';
import { registerApiOperation } from './api-route.js';

const organization: Organization = { id: '00000000-0000-4000-8000-000000000001',
  scope: { kind: 'installation' }, name: 'Synthetic team', slug: 'synthetic-team', version: 1 };
const servers: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => server.close())); });
function server(): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 4096 }); servers.push(app);
  configureSchemaCompilers(app, { schemas: apiSchemas, encodeJson });
  return app;
}

it('registers exact operation status, path and typed DTO input without exposing reply', async () => {
  const app = server();
  const handler = vi.fn(async () => organization);
  registerApiOperation(app, 'createOrganization', handler);
  const body = { scope: { kind: 'installation' }, requestId: organization.id,
    name: organization.name, slug: organization.slug };
  const result = await app.inject({ method: 'POST', url: '/api/v2/organizations', payload: body });
  expect(result.statusCode).toBe(201); expect(result.json()).toEqual(organization);
  expect(handler.mock.calls).toEqual([[{ body }]]);
  const bad = await app.inject({ method: 'POST', url: '/api/v2/organizations',
    payload: { ...body, secret: 'SYNTHETIC_QUERY_CANARY' } });
  expect(bad.statusCode).toBe(400); expect(bad.body).not.toContain('SYNTHETIC_QUERY_CANARY');
  expect(handler).toHaveBeenCalledTimes(1);
});

it('decodes only canonical page query numbers before strict schema validation', async () => {
  const app = server();
  const page = { scope: { kind: 'installation' as const }, items: [organization], nextCursor: null };
  const handler = vi.fn(async () => page);
  registerApiOperation(app, 'listOrganizations', handler);
  const result = await app.inject('/api/v2/organizations?limit=20');
  expect(result.statusCode).toBe(200); expect(result.json()).toEqual(page);
  expect(handler.mock.calls).toEqual([[{ query: { limit: 20 } }]]);
  for (const query of ['limit=020', 'limit=2e1', 'limit=20&limit=21', 'limit=20&other=1', 'limit=101', '']) {
    expect((await app.inject(`/api/v2/organizations?${query}`)).statusCode).toBe(400);
  }
  expect(handler).toHaveBeenCalledTimes(1);
});

it('binds declared route parameters to validated handlers', async () => {
  const app = server();
  const handler = vi.fn(async () => organization);
  registerApiOperation(app, 'getOrganization', handler);
  expect((await app.inject(`/api/v2/organizations/${organization.id}`)).statusCode).toBe(200);
  expect(handler.mock.calls).toEqual([[{ params: { organizationId: organization.id } }]]);
  expect((await app.inject('/api/v2/organizations/invalid-id')).statusCode).toBe(400);
  expect(handler).toHaveBeenCalledTimes(1);
});

it('captures explicit route body bounds and transport signals without changing other operations', async () => {
  const app = server(); const controller = new AbortController();
  const handler = vi.fn(async () => organization);
  const options = { bodyLimit: 64, signalFor: () => controller.signal };
  registerApiOperation(app, 'createOrganization', handler, options);
  options.bodyLimit = 4096;
  const body = { scope: { kind: 'installation' }, requestId: organization.id, name: organization.name, slug: organization.slug };
  expect(Buffer.byteLength(JSON.stringify(body))).toBeGreaterThan(64);
  const large = await app.inject({ method: 'POST', url: '/api/v2/organizations', payload: body });
  expect(large.statusCode).toBe(413); expect(handler).not.toHaveBeenCalled();
  const signalHandler = vi.fn(async () => organization);
  registerApiOperation(server(), 'getOrganization', signalHandler, { signalFor: () => controller.signal });
  const other = servers.at(-1)!;
  expect((await other.inject(`/api/v2/organizations/${organization.id}`)).statusCode).toBe(200);
  expect(signalHandler.mock.calls).toEqual([[{ params: { organizationId: organization.id }, signal: controller.signal }]]);
});

it('rejects invalid per-operation limits before route registration', () => {
  const app = server(); const handler = vi.fn(async () => organization);
  for (const bodyLimit of [0, -1, 2_097_153, 1.5, Number.NaN]) {
    expect(() => registerApiOperation(app, 'createOrganization', handler, { bodyLimit })).toThrow('Invalid operation body limit');
  }
  expect(handler).not.toHaveBeenCalled();
});

const invalidReplies: readonly [string, () => unknown][] = [
  ['raw JSON', () => JSON.stringify(organization)],
  ['buffer', () => Buffer.from('SYNTHETIC_RESPONSE_CANARY')],
  ['stream', () => Readable.from(['SYNTHETIC_RESPONSE_CANARY'])],
  ['undefined', () => undefined],
  ['array', () => [organization]],
  ['extra field', () => ({ ...organization, privateValue: 'SYNTHETIC_RESPONSE_CANARY' })],
  ['oversize', () => ({ ...organization, name: 'SYNTHETIC_RESPONSE_CANARY'.repeat(50_000) })],
  ['accessor', () => Object.defineProperty({ ...organization }, 'privateValue', {
    enumerable: true, get() { throw new Error('SYNTHETIC_RESPONSE_CANARY'); },
  })],
];
it.each(invalidReplies)('contains %s replies before the serializer bypass', async (_label, output) => {
  const app = server();
  // Deliberately broken application boundary; runtime guard must still enforce DTO.
  registerApiOperation(app, 'getOrganization', async () => output() as Organization);
  const response = await app.inject(`/api/v2/organizations/${organization.id}`);
  expect(response.statusCode).toBe(500);
  expect(response.body).not.toContain('SYNTHETIC_RESPONSE_CANARY');
  expect(response.json().code).toBe('RESPONSE_CONTRACT_INVALID');
});
