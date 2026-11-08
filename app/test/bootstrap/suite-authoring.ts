import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApiClient, SUITE_MAXIMUM_CONFIG_BYTES } from '@beetle/contracts/api';
import type { ApiClientResult, CreateSuiteRevisionRequest } from '@beetle/contracts/api';
import { encodeJson } from '@beetle/contracts';
import template from '../../../contracts/fixtures/api/valid/create-suite-revision.json' with { type: 'json' };

function value<T>(result: ApiClientResult<T>): T {
  assert(result.ok, 'Bundled suite HTTP operation failed'); return result.value;
}
function fullConfiguration(): CreateSuiteRevisionRequest['config'] {
  const config = structuredClone(template.config) as CreateSuiteRevisionRequest['config'];
  const rows: { text: string }[] = []; config.datasets = [{ id: 'owned', kind: 'inline', selection: 'byVu', rows }];
  const row = { text: '界'.repeat(990) }; const stride = Buffer.byteLength(JSON.stringify(row)) + 1;
  const initial = Buffer.byteLength(encodeJson(config, SUITE_MAXIMUM_CONFIG_BYTES));
  const count = Math.floor((SUITE_MAXIMUM_CONFIG_BYTES - initial - 12) / stride);
  for (let index = 0; index < count; index++) rows.push(row);
  const remaining = SUITE_MAXIMUM_CONFIG_BYTES - Buffer.byteLength(encodeJson(config, SUITE_MAXIMUM_CONFIG_BYTES)) - 12;
  rows.push({ text: 'x'.repeat(remaining) });
  assert.equal(Buffer.byteLength(encodeJson(config, SUITE_MAXIMUM_CONFIG_BYTES)), SUITE_MAXIMUM_CONFIG_BYTES);
  return config;
}
/** Actual generated HTTP client -> compiled Fastify -> compiled SQLite worker, no engine. */
export async function authorSuites(origin: string, cookie: string, csrfToken: string): Promise<void> {
  const api = createApiClient({ baseUrl: origin, headers: { origin, cookie, 'x-beetle-csrf': csrfToken } });
  const organization = value(await api.createOrganization({ body: { scope: { kind: 'installation' },
    requestId: randomUUID(), name: 'Owned smoke organization', slug: 'owned-smoke' } }));
  const workspace = value(await api.createWorkspace({ params: { organizationId: organization.id }, body: {
    scope: { kind: 'organization', organizationId: organization.id }, requestId: randomUUID(), name: 'Owned workspace' } }));
  const params = { organizationId: organization.id, workspaceId: workspace.id };
  const scope = { kind: 'workspace' as const, ...params };
  const suite = value(await api.createSuite({ params, body: { scope, requestId: randomUUID(), name: 'Owned suite' } }));
  assert.equal(suite.folderId, workspace.rootFolderId);
  const key = { ...params, suiteId: suite.id };
  const body: CreateSuiteRevisionRequest = { scope, requestId: randomUUID(), expectedVersion: 1,
    engineId: 'k6', configVersion: 1, config: fullConfiguration() };
  const first = value(await api.createSuiteRevision({ params: key, body }));
  assert.deepEqual(first.config, body.config); assert.equal(first.preflightStatus, 'passed');
  assert.deepEqual(value(await api.getSuiteRevision({ params: { ...params, revisionId: first.id } })), first);
  const renamed = value(await api.patchSuite({ params: key, body: { scope, requestId: randomUUID(), expectedVersion: 2, name: 'Renamed' } }));
  assert.equal(renamed.version, 3);
  assert.deepEqual(value(await api.createSuiteRevision({ params: key, body })), first);
  const page = value(await api.listSuiteRevisions({ params: key, query: { limit: 100 } }));
  assert.equal(page.items.length, 1); assert(!Object.hasOwn(page.items[0]!, 'config'));
  assert.deepEqual(value(await api.getSuite({ params: key })), renamed);
}
