import { afterEach, expect, it, vi } from 'vitest';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { encodeJson } from '@beetle/contracts';
import { apiSchemas, validateApi } from '@beetle/contracts/api';
import type { SettingsScope, PatchWorkspaceSettingsRequest } from '@beetle/contracts/api';
import type { SettingsView } from '../../../ports/settings-reader.js';
import { createApiServer, ApiFault } from './api-errors.js';
import { configureSchemaCompilers } from './schema-compilers.js';
import { registerSettingsRoutes } from './settings/index.js';
import type { SettingsRouteOptions } from './settings/index.js';
import { classifyMetadataError } from '../../../bootstrap/metadata-errors.js';
import { storageFixture, digest, requestId, seed, scope, uuid, command, settingsFixture } from '../../../../test/storage/fixture.js';

const fixture = storageFixture();
const servers: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => server.close())); });
const auth = { authorization: 'SYNTHETIC_PAIRED_SESSION' };
const installation: SettingsScope = { kind: 'installation' };
function route(owner: SettingsScope): string {
  if (owner.kind === 'installation') return '/api/v2/settings';
  const org = `/api/v2/organizations/${encodeURIComponent(owner.organizationId)}`;
  return owner.kind === 'organization' ? `${org}/settings` : `${org}/workspaces/${encodeURIComponent(owner.workspaceId)}/settings`;
}
async function setup() {
  const metadata = await fixture.open(undefined, { runtimeTtlMs: 60000 });
  await seed(metadata); await seed(metadata, 21, 22, 23);
  const server = createApiServer({ classify: classifyMetadataError }); servers.push(server);
  configureSchemaCompilers(server, { schemas: apiSchemas, encodeJson });
  const authorize = vi.fn(async (request: FastifyRequest) => {
    if (request.headers.authorization !== auth.authorization) throw new ApiFault('unpaired');
  });
  const getSettings = vi.fn(metadata.getSettings.bind(metadata));
  const getSettingsIdentity = vi.fn(metadata.getSettingsIdentity.bind(metadata));
  const execute = vi.fn(metadata.settings.execute.bind(metadata.settings));
  registerSettingsRoutes(server, { reader: { getSettings, getSettingsIdentity }, store: { execute }, digest, authorize });
  async function read(owner: SettingsScope) {
    return server.inject({ url: route(owner), headers: auth });
  }
  async function patch(owner: SettingsScope, patch: object, expectedVersion = 1, intent = requestId(), bodyScope = owner) {
    return server.inject({ method: 'PATCH', url: route(owner), headers: auth,
      payload: { scope: bodyScope, schemaVersion: 2, expectedVersion, requestId: intent, patch } });
  }
  return { server, metadata, read, patch, authorize, getSettings, getSettingsIdentity, execute };
}

it('wires all six shipped operations with inheritance, effective sources and override clear', async () => {
  const { read, patch } = await setup();
  const org: SettingsScope = { kind: 'organization', organizationId: scope.organizationId };
  for (const [owner, schema] of [[installation, 'InstallationSettings'], [org, 'OrganizationSettings'],
    [scope, 'WorkspaceSettings']] as const) {
    const response = await read(owner);
    expect(response.statusCode).toBe(200); expect(validateApi(schema, response.json()).ok).toBe(true);
    expect(response.json().effective.runDefaults.budget.cpuMillis.source).toEqual(installation);
  }
  const defaults = settingsFixture().chain.installation.values.runDefaults;
  const global = await patch(installation, { runDefaults: { ...defaults, budget: { ...defaults.budget, cpuMillis: 150 } } });
  expect(global.statusCode).toBe(200); expect(global.json().version).toBe(2);
  const organization = await patch(org, { runDefaults: { budget: { cpuMillis: 200 } } });
  expect(organization.statusCode).toBe(200);
  expect(organization.json().effective.runDefaults.budget.cpuMillis).toMatchObject({ value: 200, source: org });
  expect((await read(scope)).json().effective.runDefaults.budget.cpuMillis).toMatchObject({ value: 200, source: org });
  const workspace = await patch(scope, { runDefaults: { budget: { cpuMillis: 250 } } });
  expect(workspace.statusCode).toBe(200); expect(validateApi('WorkspaceSettings', workspace.json()).ok).toBe(true);
  expect(workspace.json().effective.runDefaults.budget.cpuMillis).toMatchObject({ value: 250, source: scope });
  const cleared = await patch(scope, { runDefaults: { budget: { cpuMillis: null } } }, 2);
  expect(cleared.statusCode).toBe(200); expect(cleared.json().overrides).toEqual({});
  expect(cleared.json().effective.runDefaults.budget.cpuMillis).toMatchObject({ value: 200, source: org });
  expect((await patch(org, { runDefaults: null }, 2)).statusCode).toBe(200);
  expect((await read(scope)).json().effective.runDefaults.budget.cpuMillis).toMatchObject({ value: 150, source: installation });
});

it('keeps independent scopes isolated and refuses wrong route/body/owner IDs', async () => {
  const { read, patch } = await setup();
  const other = { kind: 'workspace', organizationId: uuid(21), workspaceId: uuid(22) } as const;
  expect((await patch(scope, { retention: { mode: 'enabled', ageDays: 30 } })).statusCode).toBe(200);
  expect((await read(other)).json().effective.retention).toEqual({ value: { mode: 'manual' }, source: installation });
  expect((await patch(other, { retention: { mode: 'manual' } }, 1, requestId(), scope)).statusCode).toBe(404);
  const wrongOwner = { ...scope, organizationId: uuid(21) };
  expect((await read(wrongOwner)).statusCode).toBe(404);
  expect((await patch(wrongOwner, { retention: { mode: 'manual' } })).statusCode).toBe(404);
  expect((await read({ kind: 'organization', organizationId: uuid(99) })).statusCode).toBe(404);
  expect((await patch({ kind: 'organization', organizationId: uuid(99) }, { retention: null })).statusCode).toBe(404);
});

it('returns stale/different-intent conflicts and original replay after runtime becomes unknown', async () => {
  const { patch, metadata, getSettings } = await setup();
  const intent = requestId(); const change = { runDefaults: { budget: { cpuMillis: 200 } } };
  const first = await patch(scope, change, 1, intent);
  expect(first.statusCode).toBe(200); expect(first.json().version).toBe(2);
  expect((await patch(scope, change)).statusCode).toBe(409);
  expect((await patch(scope, { retention: null }, 1, intent)).statusCode).toBe(409);
  await metadata.updateRuntime(null);
  const replay = await patch(scope, change, 1, intent);
  expect(replay.statusCode).toBe(200); expect(replay.json()).toEqual(first.json());
  expect(getSettings).not.toHaveBeenCalled();
  const fresh = await patch(scope, { retention: { mode: 'manual' } }, 2);
  expect(fresh.statusCode).toBe(503); expect(fresh.json().code).toBe('capacity_unavailable');
  const failedRead = await metadata.getSettings(scope).then(() => false, () => true);
  expect(failedRead).toBe(true);
  const identity = await metadata.getSettingsIdentity(scope); expect(identity.scope).toEqual(scope);
});

it('enforces auth before parse and every read/write, with no anonymous registration fallback', async () => {
  const { server, getSettings, getSettingsIdentity, execute } = await setup();
  for (const owner of [installation, { kind: 'organization', organizationId: uuid(1) } as const, scope]) {
    expect((await server.inject(route(owner))).statusCode).toBe(401);
    const response = await server.inject({ method: 'PATCH', url: route(owner),
      headers: { 'content-type': 'application/json' }, payload: '{malformed SYNTHETIC_SECRET' });
    expect(response.statusCode).toBe(401); expect(validateApi('ApiError', response.json()).ok).toBe(true);
    expect(response.body).not.toContain('SYNTHETIC_SECRET');
  }
  expect(getSettings).not.toHaveBeenCalled(); expect(getSettingsIdentity).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  const empty = createApiServer(); servers.push(empty);
  expect(() => registerSettingsRoutes(empty, {} as SettingsRouteOptions)).toThrow('authorization guard required');
});

it('rejects malformed fields and out-of-policy capacity without publishing submitted values', async () => {
  const { server, patch } = await setup();
  const valid: PatchWorkspaceSettingsRequest = { scope, expectedVersion: 1, requestId: requestId(), schemaVersion: 2,
    patch: { retention: { mode: 'manual' } } };
  for (const invalid of [{ ...valid, extra: 'SYNTHETIC_SECRET' }, { ...valid, schemaVersion: 1 },
    { ...valid, expectedVersion: '1' }, { ...valid, patch: {} }, { ...valid, patch: { runDefaults: { budget: { cpuMillis: 0 } } } }]) {
    const response = await server.inject({ method: 'PATCH', url: route(scope), headers: auth, payload: invalid });
    expect(response.statusCode).toBe(400); expect(response.body).not.toContain('SYNTHETIC_SECRET');
  }
  const response = await patch(scope, { runDefaults: { budget: { cpuMillis: 1001 } } });
  expect(response.statusCode).toBe(422); expect(response.json().code).toBe('invalid_value');
  const pool = settingsFixture().chain.installation.values.pool;
  const overCapacity = await patch(installation, { pool: { ...pool, cpuMillis: 4001 } });
  expect(overCapacity.statusCode).toBe(503); expect(overCapacity.json().code).toBe('capacity_unavailable');
});

it('contains broken reader scope/provenance and internal errors without leaking values', async () => {
  const { metadata, read, patch, getSettings, getSettingsIdentity, execute } = await setup();
  const original = await metadata.getSettings(scope);
  const foreignScope = { ...scope, organizationId: uuid(21) };
  for (const broken of ['scope', 'provenance', 'nonJSON', 'oversize']) {
    const value = JSON.parse(JSON.stringify(original)) as SettingsView;
    if (broken === 'scope') value.scope = foreignScope;
    if (broken === 'provenance') value.effective.retention.source = foreignScope;
    if (broken === 'nonJSON') Object.assign(value, { secret: () => 'SYNTHETIC_SECRET' });
    if (broken === 'oversize') Object.assign(value, { secret: 'SYNTHETIC_SECRET'.repeat(10000) });
    getSettings.mockImplementation(async supplied => { Reflect.set(supplied, 'organizationId', uuid(21)); return value; });
    const response = await read(scope);
    expect(response.statusCode).toBe(broken === 'scope' || broken === 'provenance' ? 404 : 500);
    expect(response.body).not.toContain('SYNTHETIC_SECRET'); expect(validateApi('ApiError', response.json()).ok).toBe(true);
  }
  getSettingsIdentity.mockImplementation(async supplied => {
    Reflect.set(supplied, 'organizationId', uuid(21)); return { id: original.id, scope: foreignScope };
  });
  expect((await patch(scope, { retention: { mode: 'manual' } })).statusCode).toBe(404);
  expect(execute).not.toHaveBeenCalled();
  getSettingsIdentity.mockImplementation(async () => { throw new Error('SYNTHETIC_SECRET'); });
  const response = await patch(scope, { retention: { mode: 'manual' } });
  expect(response.statusCode).toBe(500); expect(response.body).not.toContain('SYNTHETIC_SECRET');
});

it('folds UUID case while keeping URNs distinct from bare UUID scope identities', async () => {
  const { metadata, read, patch } = await setup();
  const org = 'urn:uuid:abcdefab-cdef-4abc-8def-abcdefabcdef';
  const workspace = 'urn:uuid:abcdefab-cdef-4abc-8def-abcdefabcdee';
  await metadata.namespaces.execute(command({ kind: 'createOrganization', id: org.toUpperCase(),
    request: { scope: installation as { kind: 'installation' }, requestId: requestId(), name: 'URN', slug: 'urn' } }));
  await metadata.namespaces.execute(command({ kind: 'createWorkspace', id: workspace, rootFolderId: uuid(88),
    request: { scope: { kind: 'organization', organizationId: org }, requestId: requestId(), name: 'URN' } }));
  const owner = { kind: 'workspace', organizationId: org, workspaceId: workspace } as const;
  const upper = { ...owner, organizationId: org.toUpperCase(), workspaceId: workspace.toUpperCase() };
  expect((await read(upper)).statusCode).toBe(200);
  const changed = await patch(upper, { retention: { mode: 'manual' } }, 1, requestId(), owner);
  expect(changed.statusCode).toBe(200); expect(changed.json().scope).toEqual(owner);
  expect((await read({ ...owner, organizationId: org.slice(9) })).statusCode).toBe(404);
  expect((await read({ ...owner, workspaceId: workspace.slice(9) })).statusCode).toBe(404);
  expect((await patch(owner, { retention: null }, 2, requestId(), { ...owner, workspaceId: workspace.slice(9) })).statusCode).toBe(404);
});
