import Fastify from 'fastify';
import { afterEach, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { readFile } from 'node:fs/promises';
import { encodeJson } from '@beetle/contracts';
import { apiSchemas } from '@beetle/contracts/api';
import type { RunMetricSamplesPage } from '@beetle/contracts/api';
import { configureSchemaCompilers } from './schema-compilers.js';
import { registerApiOperation } from './api-route.js';
import type { ApiHandler } from './api-route.js';
import { decodeMetricSamplesQuery } from './page-query.js';

const servers: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => server.close())); });
it('decodes canonical metric query fields through the shipped operation before strict validation', async () => {
  const page = JSON.parse(await readFile('contracts/fixtures/api/valid/run-metric-samples.json', 'utf8')) as RunMetricSamplesPage;
  const app = Fastify({ logger: false }); servers.push(app);
  configureSchemaCompilers(app, { schemas: apiSchemas, encodeJson });
  const handler = vi.fn<ApiHandler<'getRunMetricSamples'>>(async () => page);
  registerApiOperation(app, 'getRunMetricSamples', handler);
  const route = `/api/v2/organizations/${page.scope.organizationId}/workspaces/${page.scope.workspaceId}/runs/${page.id}/attempts/${page.attemptId}/metrics/samples`;
  const reply = await app.inject(`${route}?seriesOrdinal=0&limit=100&fromTimeMs=0&toTimeMs=8640000000000000`);
  expect(reply.statusCode).toBe(200); expect(reply.json()).toEqual(page);
  expect(handler.mock.calls[0]?.[0]).toEqual({ params: { organizationId: page.scope.organizationId,
    workspaceId: page.scope.workspaceId, runId: page.id, attemptId: page.attemptId },
  query: { seriesOrdinal: 0, limit: 100, fromTimeMs: 0, toTimeMs: 8640000000000000 } });
  for (const query of ['seriesOrdinal=00&limit=100', 'seriesOrdinal=0&limit=1e2',
    'seriesOrdinal=0&seriesOrdinal=1&limit=100', 'seriesOrdinal=0&limit=100&fromTimeMs=-1',
    'seriesOrdinal=0&limit=100&toTimeMs=8640000000000001', 'limit=100',
    'seriesOrdinal=0&limit=100&extra=true']) {
    expect((await app.inject(`${route}?${query}`)).statusCode).toBe(400);
  }
  expect(handler).toHaveBeenCalledTimes(1);
});
it('captures bounded data fields without invoking accessors or mutating HTTP input', () => {
  const input = { seriesOrdinal: '0', limit: '100' };
  expect(decodeMetricSamplesQuery(input)).toEqual({ ok: true, value: { seriesOrdinal: 0, limit: 100 } });
  expect(input).toEqual({ seriesOrdinal: '0', limit: '100' });
  const get = vi.fn(() => '0');
  expect(decodeMetricSamplesQuery(Object.defineProperty({ limit: '100' }, 'seriesOrdinal', { get, enumerable: true }))).toEqual({ ok: false });
  expect(get).not.toHaveBeenCalled();
  for (const bad of [null, [], { seriesOrdinal: 0, limit: '100' }, { seriesOrdinal: '0', limit: '100', cursor: 'x'.repeat(5000) }]) {
    expect(decodeMetricSamplesQuery(bad)).toEqual({ ok: false });
  }
});
