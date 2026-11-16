import { readFileSync } from 'node:fs';
import Fastify from 'fastify';
import { afterEach, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { encodeJson } from '@beetle/contracts';
import { apiSchemas, apiMessageSchemas } from '@beetle/contracts/api';
import { configureSchemaCompilers } from './schema-compilers.js';

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../../../../../contracts/fixtures/api/valid/${name}.json`, import.meta.url), 'utf8')) as unknown;
}
const servers: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => server.close())); });
function server(): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 16_384 }); servers.push(app);
  configureSchemaCompilers(app, { schemas: apiSchemas, encodeJson });
  return app;
}

it('registers the complete API catalogue once and preserves namespace request/response shapes', async () => {
  const app = server();
  const organization = fixture('organization');
  const handler = vi.fn(() => organization);
  app.post('/organizations', { schema: { body: apiMessageSchemas.CreateOrganizationRequest,
    response: { 201: apiMessageSchemas.Organization } } }, async (_request, reply) => reply.code(201).send(handler()));
  const request = fixture('create-organization') as object;
  const response = await app.inject({ method: 'POST', url: '/organizations', payload: request });
  expect(response.statusCode).toBe(201); expect(response.json()).toEqual(organization);
  const invalid = { ...request, secretValue: 'SYNTHETIC_API_CANARY' };
  const bad = await app.inject({ method: 'POST', url: '/organizations', payload: invalid });
  expect(bad.statusCode).toBe(400); expect(bad.body).not.toContain(invalid.secretValue);
  expect(handler).toHaveBeenCalledTimes(1);
  expect(new Set(apiSchemas.map(schema => schema.$id)).size).toBe(apiSchemas.length);
});

it('rejects extra namespace response fields without silently removing or returning them', async () => {
  const app = server();
  app.get('/organization', { schema: { response: { 200: apiMessageSchemas.Organization } } }, async () => ({
    ...(fixture('organization') as object), unexpected: 'SYNTHETIC_API_RESPONSE_CANARY',
  }));
  const response = await app.inject('/organization');
  expect(response.statusCode).toBe(500);
  expect(response.body).not.toContain('SYNTHETIC_API_RESPONSE_CANARY');
});
