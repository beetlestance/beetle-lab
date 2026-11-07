import type { FastifyInstance } from 'fastify';
import { afterEach, expect, it } from 'vitest';
import { encodeJson } from '@beetle/contracts';
import { apiSchemas, validateApi } from '@beetle/contracts/api';
import type { ApiError } from '@beetle/contracts/api';
import { SemanticError } from '../../../domain/namespaces/index.js';
import { configureSchemaCompilers } from './schema-compilers.js';
import { registerApiOperation } from './api-route.js';
import { ApiFault, createApiServer } from './api-errors.js';
import type { ApiErrorOptions } from './api-errors.js';

const canary = 'SYNTHETIC_PRIVATE_EXCEPTION_CANARY';
const uuid = '00000000-0000-4000-8000-000000000001';
const servers: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => server.close())); });
function server(options: ApiErrorOptions = {}): FastifyInstance {
  const app = createApiServer({ ...options, bodyLimit: 1024 }); servers.push(app);
  configureSchemaCompilers(app, { schemas: apiSchemas, encodeJson });
  return app;
}
function check(status: number, body: string, expected: ApiError['code']): ApiError {
  expect(body).not.toContain(canary);
  const value = JSON.parse(body) as ApiError;
  expect(validateApi('ApiError', value).ok).toBe(true);
  expect(value.code).toBe(expected);
  expect(status).toBeGreaterThanOrEqual(400);
  return value;
}

it.each([
  ['malformed_request', 400], ['unpaired', 401], ['forbidden', 403], ['not_found', 404],
  ['conflict', 409], ['body_limit', 413], ['invalid_value', 422], ['capacity_unavailable', 503],
  ['storage_unavailable', 503], ['cursor_expired', 409], ['protected_dependency', 409], ['internal_error', 500], ['rate_limited', 429],
] as const)('maps %s to a fixed contract reply and fresh correlation ID', async (code, status) => {
  const app = server();
  app.get('/failure', async () => { throw new ApiFault(code); });
  const result = await app.inject({ url: '/failure', headers: { 'x-request-id': canary } });
  expect(result.statusCode).toBe(status);
  const value = check(result.statusCode, result.body, code);
  const again = await app.inject('/failure');
  expect(again.json().requestId).not.toBe(value.requestId);
});

it('contains handler exceptions and maps concrete errors only through trusted composition', async () => {
  const app = server({ classify: error => error instanceof RangeError ? 'storage_unavailable' : undefined });
  app.get('/unexpected', async () => { throw new Error(canary); });
  app.get('/storage', async () => { throw new RangeError(canary); });
  app.get('/semantic', async () => { throw new SemanticError('conflict'); });
  for (const [url, code, status] of [
    ['/unexpected', 'internal_error', 500], ['/storage', 'storage_unavailable', 503], ['/semantic', 'conflict', 409],
  ] as const) {
    const result = await app.inject(url); expect(result.statusCode).toBe(status);
    check(result.statusCode, result.body, code);
  }
});

it('contains a broken classifier and refuses inherited/public code spoofing', async () => {
  const app = server({ classify: () => { throw new Error(canary); } });
  app.get('/broken', async () => { throw new Error(canary); });
  app.get('/spoof', async () => { throw Object.assign(new Error(canary), { code: 'not_found' }); });
  for (const url of ['/broken', '/spoof']) {
    const result = await app.inject(url); expect(result.statusCode).toBe(500);
    check(result.statusCode, result.body, 'internal_error');
  }
});

it('contains request/query/schema/body-size/parser/not-found and serializer failures', async () => {
  const app = server();
  registerApiOperation(app, 'createOrganization', async () => ({ id: uuid, name: canary,
    slug: 'example', version: 1, scope: { kind: 'installation' }, extra: canary }));
  registerApiOperation(app, 'listOrganizations', async () => ({ scope: { kind: 'installation' }, items: [], nextCursor: null }));
  const valid = { requestId: uuid, scope: { kind: 'installation' }, name: 'Example', slug: 'example' };
  const cases = [
    { method: 'POST' as const, url: '/api/v2/organizations', payload: { ...valid, extra: canary }, expected: 'malformed_request' },
    { method: 'POST' as const, url: '/api/v2/organizations', payload: { ...valid, name: canary.repeat(100) }, expected: 'body_limit' },
    { method: 'GET' as const, url: `/api/v2/organizations?limit=${canary}`, expected: 'malformed_request' },
    { method: 'GET' as const, url: `/${canary}`, expected: 'not_found' },
    { method: 'POST' as const, url: '/api/v2/organizations', payload: valid, expected: 'internal_error' },
  ] as const;
  for (const { expected, ...request } of cases) {
    const result = await app.inject(request); check(result.statusCode, result.body, expected);
  }
  const malformed = await app.inject({ method: 'POST', url: '/api/v2/organizations',
    payload: `{"${canary}":`, headers: { 'content-type': 'application/json' } });
  expect(malformed.statusCode).toBe(400); check(malformed.statusCode, malformed.body, 'malformed_request');
});

it.each([`/items/${canary}%ZZ`, `/items/${canary}${'x'.repeat(200)}`])(
  'contains pre-router URL errors without echoing %s', async url => {
    const app = server();
    app.get('/items/:id', async () => ({ ok: true }));
    const result = await app.inject(url);
    expect(result.statusCode).toBe(400);
    check(result.statusCode, result.body, 'malformed_request');
  },
);

it('maps a content-length mismatch to malformed request', async () => {
  const app = server();
  app.post('/body', async () => ({ ok: true }));
  const result = await app.inject({ method: 'POST', url: '/body', payload: '{}',
    headers: { 'content-type': 'application/json', 'content-length': '10' } });
  expect(result.statusCode).toBe(400);
  check(result.statusCode, result.body, 'malformed_request');
});

it.each([0, -1, 1.5, Infinity, 1_048_577])('rejects invalid constructor body limit %s', bodyLimit => {
  expect(() => createApiServer({ bodyLimit })).toThrow('Invalid API body limit');
});
