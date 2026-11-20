import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { encodeJson } from '@beetle/contracts';
import { apiSchemas } from '@beetle/contracts/api';
import { expect, it, vi } from 'vitest';
import { history } from '../retention/selection-fixture.js';
import { runIds } from '../storage/run-pin-fixtures.js';
import { scope, storageFixture, uuid } from '../storage/fixture.js';
import { protectHistorical } from '../../src/bootstrap/historical.js';
import { createApiServer } from '../../src/adapters/inbound/http/api-errors.js';
import { configureSchemaCompilers } from '../../src/adapters/inbound/http/schema-compilers.js';
import { registerRunComparisonRoutes } from '../../src/adapters/inbound/http/run-comparison/index.js';
import { createLocalSession } from '../../src/adapters/inbound/http/session/index.js';
import { createRunComparisonService } from '../../src/application/run-comparison/index.js';

const storage = storageFixture();
const host = '127.0.0.1:43131';
const origin = `http://${host}`;
const workspace = `/api/v2/organizations/${scope.organizationId}/workspaces/${scope.workspaceId}`;

it('opens the scoped comparison query on read-only metadata while protecting credentials and writes', async () => {
  const fixture = history(2);
  const ids = runIds(fixture.db);
  const path = storage.path();
  fixture.db.prepare('VACUUM INTO ?').run(path);
  const installation = fixture.settings.chain(scope).installation;
  fixture.db.close();
  const digest = async () =>
    createHash('sha256')
      .update(await readFile(path))
      .digest('hex');
  const before = await digest();
  const archive = await storage.open(path, { readOnly: true, runtime: null, runs: fixture.config, installation });
  const server = createApiServer();
  configureSchemaCompilers(server, { schemas: apiSchemas, encodeJson });
  protectHistorical(server);
  const session = createLocalSession({ externalOrigin: origin, readOnly: true });
  session.registerRoutes(server);
  const write = vi.fn(async () => ({}));
  server.post(workspace + '/runs', write);
  const comparisons = registerRunComparisonRoutes(server, {
    authorize: session.authorize,
    service: createRunComparisonService({
      runs: archive.runs,
      results: archive.results,
      suites: archive.suites,
      metrics: { lookupRunMetricSeries: vi.fn() },
      digest: (input) => createHash('sha256').update(input).digest('hex'),
    }),
  });
  const headers = { host, origin, 'content-type': 'application/json' };
  try {
    const opened = await server.inject({
      method: 'POST',
      url: '/api/v2/auth/pair',
      headers: { ...headers, 'x-beetle-pair': '1' },
      payload: { bootstrapToken: session.bootstrapToken },
    });
    expect(opened.statusCode).toBe(200);
    const raw = opened.headers['set-cookie'];
    const cookie = (Array.isArray(raw) ? raw[0]! : raw!).split(';')[0]!;
    const auth = { ...headers, cookie, 'x-beetle-csrf': opened.json<{ csrfToken: string }>().csrfToken };
    const comparison = {
      method: 'POST' as const,
      url: workspace + '/comparisons',
      payload: { scope, runIds: ids, metric: null },
    };
    expect((await server.inject({ ...comparison, headers: { ...headers, cookie } })).statusCode).toBe(403);
    const mismatch = await server.inject({
      ...comparison,
      headers: auth,
      payload: { ...comparison.payload, scope: { ...scope, workspaceId: uuid(9800) } },
    });
    expect(mismatch.statusCode).toBe(403);
    const tooLarge = await server.inject({
      ...comparison,
      headers: auth,
      payload: JSON.stringify(comparison.payload).padEnd(4097, ' '),
    });
    expect(tooLarge.statusCode).toBe(413);
    const read = await server.inject({ ...comparison, headers: auth });
    expect(read.statusCode, read.body).toBe(200);
    expect(read.json()).toMatchObject({ scope, baselineRunId: ids[0], items: ids.map((id) => ({ run: { id } })) });
    expect(
      (await server.inject({ method: 'POST', url: workspace + '/runs', headers: auth, payload: '{' })).statusCode,
    ).toBe(403);
    expect(write).not.toHaveBeenCalled();
  } finally {
    session.close();
    await comparisons.close();
    await server.close();
    await storage.close(archive);
  }
  expect(await digest()).toBe(before);
});
