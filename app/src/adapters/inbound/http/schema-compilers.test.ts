import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { configureSchemaCompilers } from './schema-compilers.js';

const servers: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => server.close())); });
const identifier = 'https://schemas.example.invalid/foundation/observation';
const observation = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', $id: identifier,
  type: 'object', properties: { count: { type: 'integer' }, unit: { type: 'string', maxLength: 16 } },
  required: ['count'], dependentRequired: { unit: ['count'] }, unevaluatedProperties: false,
};

/** Synthetic fixture only; product binding supplies the shared strict bounded encoder. */
function encodeFixture(input: unknown, maximum: number): string {
  const text = JSON.stringify(input);
  if (Buffer.byteLength(text) > maximum) throw new Error('Fixture limit exceeded');
  return text;
}
function fixture(encodeJson = encodeFixture, maximumResponseBytes = 1024): FastifyInstance {
  const server = Fastify({ logger: false, bodyLimit: 1024 }); servers.push(server);
  configureSchemaCompilers(server, { schemas: [observation], encodeJson, maximumResponseBytes });
  return server;
}

describe('Fastify draft2020 compiler bridge', () => {
  it('validates request and response references without coercion or removing extra fields', async () => {
    const server = fixture();
    const handled = vi.fn((value: unknown) => value);
    server.post('/observation', { schema: { body: { $ref: identifier }, response: { 200: { $ref: identifier } } } },
      async request => handled(request.body));
    const input = { count: 3, unit: 'requests' };
    const good = await server.inject({ method: 'POST', url: '/observation', payload: input });
    expect(good.statusCode).toBe(200); expect(good.json()).toEqual(input);
    for (const payload of [{ count: '3' }, { count: 3, extra: true }, { unit: 'requests' }]) {
      expect((await server.inject({ method: 'POST', url: '/observation', payload })).statusCode).toBe(400);
    }
    expect(handled).toHaveBeenCalledTimes(1);
    expect(input).toEqual({ count: 3, unit: 'requests' });
  });

  it('does not apply schema defaults to accepted request data', async () => {
    const server = fixture();
    server.post('/defaults', { schema: { body: { type: 'object', properties: {
      count: { type: 'integer', default: 7 },
    }, additionalProperties: false } } }, async request => request.body);
    expect((await server.inject({ method: 'POST', url: '/defaults', payload: {} })).json()).toEqual({});
  });

  it('rejects invalid responses without returning private values or silently dropping fields', async () => {
    const server = fixture();
    const body = { count: 1, extra: 'SYNTHETIC_RESPONSE_CANARY' };
    server.get('/bad', { schema: { response: { 200: { $ref: identifier } } } }, async () => body);
    const response = await server.inject('/bad');
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain(body.extra);
    expect(response.json().code).toBe('RESPONSE_CONTRACT_INVALID');
    expect(body.extra).toBe('SYNTHETIC_RESPONSE_CANARY');
  });

  it('contains encoder errors, invalid JSON and oversized encoded replies', async () => {
    for (const encodeJson of [() => { throw new Error('SYNTHETIC_ENCODER_CANARY'); }, () => '{', () => 'x'.repeat(33)]) {
      const server = fixture(encodeJson, 32);
      server.get('/failure', { schema: { response: { 200: { $ref: identifier } } } }, async () => ({ count: 1 }));
      const response = await server.inject('/failure');
      expect(response.statusCode).toBe(500);
      expect(response.body).not.toContain('SYNTHETIC_ENCODER_CANARY');
    }
  });

  it.each([0, -1, 1.5, Infinity, 16_777_217])('refuses invalid response budget %s', maximum => {
    expect(() => fixture(encodeFixture, maximum)).toThrow(RangeError);
  });
});
