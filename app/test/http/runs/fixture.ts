import { pendingRunHistorySummary } from '@beetle/contracts/api';
import { vi } from 'vitest';
import { encodeJson } from '@beetle/contracts';
import { apiSchemas } from '@beetle/contracts/api';
import type { BrowserSession } from '@beetle/contracts/api';
import { createApiServer } from '../../../src/adapters/inbound/http/api-errors.js';
import { configureSchemaCompilers } from '../../../src/adapters/inbound/http/schema-compilers.js';
import { createLocalSession } from '../../../src/adapters/inbound/http/session/index.js';
import { registerRunRoutes } from '../../../src/adapters/inbound/http/runs/index.js';
import type { RunCancellationStore, RunReader, RunStore } from '../../../src/ports/runs.js';
import { digest, operation, runValue } from '../../application/runs/fixture.js';

export const host = '127.0.0.1:43127';
export const origin = `http://${host}`;
export function fixture() {
  const server = createApiServer();
  configureSchemaCompilers(server, { schemas: apiSchemas, encodeJson });
  const session = createLocalSession({ externalOrigin: origin });
  session.registerRoutes(server);
  const cancel = vi.fn<RunCancellationStore['cancel']>(async () => ({ ...runValue(), cancellationRequested: true, version: 2 }));
  const execute = vi.fn<RunStore['execute']>(async () => runValue());
  const getRun = vi.fn<RunReader['getRun']>(async () => runValue());
  const listRuns = vi.fn<RunReader['listRuns']>(async () => ({ scope: runValue().scope, items: [runValue()], summaries: [pendingRunHistorySummary(runValue())], nextCursor: null }));
  let allocation = 7;
  const newId = vi.fn(() => `00000000-0000-4000-8000-${String(allocation++).padStart(12, '0')}`);
  const now = vi.fn(() => '2026-11-10T00:00:00.000Z');
  registerRunRoutes(server, { store: { execute, cancel }, reader: { getRun, listRuns },
    newId, now, digest, authorize: session.authorize });
  const body = operation().request;
  const base = `/api/v2/organizations/${body.scope.organizationId}/workspaces/${body.scope.workspaceId}/runs`;
  const paired = async () => {
    const response = await server.inject({ method: 'POST', url: '/api/v2/auth/pair',
      headers: { host, origin, 'x-beetle-pair': '1' }, payload: { bootstrapToken: session.bootstrapToken } });
    if (response.statusCode !== 200) throw new Error('Synthetic session pairing failed');
    const view = response.json<BrowserSession>();
    return { host, origin, cookie: String(response.headers['set-cookie']).split(';')[0]!,
      'x-beetle-csrf': view.csrfToken };
  };
  const close = async () => { session.close(); await server.close(); };
  return { server, body, base, execute, cancel, getRun, listRuns, newId, now, paired, close };
}
