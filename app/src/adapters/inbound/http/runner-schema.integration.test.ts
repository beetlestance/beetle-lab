import { readFileSync } from 'node:fs';
import Fastify from 'fastify';
import { afterEach, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { encodeJson, runnerSchemas, runnerMessageSchemas } from '@beetle/contracts';
import { configureSchemaCompilers } from './schema-compilers.js';

const offer: unknown = JSON.parse(readFileSync(new URL('../../../../../contracts/fixtures/valid/offer.json', import.meta.url), 'utf8'));
const snapshot: unknown = JSON.parse(readFileSync(new URL('../../../../../contracts/fixtures/valid/snapshot.json', import.meta.url), 'utf8'));
const servers: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => server.close())); });
function fixture(): FastifyInstance {
  const server = Fastify({ logger: false, bodyLimit: 16_384 }); servers.push(server);
  configureSchemaCompilers(server, { schemas: runnerSchemas, encodeJson });
  return server;
}

it('uses the actual frozen runner catalogue and bounded encoder through Fastify', async () => {
  const server = fixture();
  const handler = vi.fn(() => snapshot);
  server.post('/offer', { schema: { body: { $ref: runnerMessageSchemas.Offer.$id },
    response: { 200: { $ref: runnerMessageSchemas.AttemptSnapshot.$id } } } }, async () => handler());
  const good = await server.inject({ method: 'POST', url: '/offer', payload: offer as object });
  expect(good.statusCode).toBe(200); expect(good.json()).toEqual(snapshot);
  const invalid = { ...(offer as Record<string, unknown>), secretValue: 'SYNTHETIC_PRIVATE_CANARY' };
  const bad = await server.inject({ method: 'POST', url: '/offer', payload: invalid });
  expect(bad.statusCode).toBe(400); expect(bad.body).not.toContain(invalid.secretValue);
  expect(handler).toHaveBeenCalledTimes(1);
  expect(Object.isFrozen(runnerSchemas)).toBe(true);
});

it('the shared encoder rejects a response getter before AJV observes its value', async () => {
  const server = fixture();
  let observations = 0;
  const result = { ...(snapshot as Record<string, unknown>) };
  Object.defineProperty(result, 'generation', { enumerable: true, get() {
    observations++; throw new Error('SYNTHETIC_GETTER_CANARY');
  } });
  server.get('/snapshot', { schema: { response: { 200: { $ref: runnerMessageSchemas.AttemptSnapshot.$id } } } }, async () => result);
  const response = await server.inject('/snapshot');
  expect(response.statusCode).toBe(500);
  expect(response.body).not.toContain('SYNTHETIC_GETTER_CANARY');
  expect(observations).toBe(0);
});
