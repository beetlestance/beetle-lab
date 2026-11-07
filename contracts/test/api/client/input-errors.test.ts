import { expect, it, vi } from 'vitest';
import { createApiClient } from '../../../src/api/index.js';
import type { ApiClientResult } from '../../../src/api/index.js';
import { baseUrl, load, organizationId, params, reply } from './helpers.js';

it.each([
  { params: { organizationId: '../escape' } },
  { params: { organizationId, unexpected: true } },
  { params: { organizationId }, query: { limit: 1 } },
  { params: { organizationId }, body: {} },
  { params: { organizationId }, signal: {} },
  { params: { organizationId }, signal: Object.create(AbortSignal.prototype) as AbortSignal },
  null, [], new Date(),
])('rejects invalid or unexpected inputs before URI encoding/fetch: %j', async input => {
  const fetcher = reply({});
  const client = createApiClient({ baseUrl, fetch: fetcher });
  const invoke = client.getOrganization as (input: unknown) => Promise<ApiClientResult<unknown>>;
  expect(await invoke(input)).toEqual({ ok: false, error: { kind: 'request' } });
  expect(fetcher).not.toHaveBeenCalled();
});

it.each([{ limit: '2' }, { limit: 2, cursor: '../bad' }, { limit: 2, extra: true }, { limit: 101 }])('validates query metadata before fetch', async query => {
  const fetcher = reply({}); const client = createApiClient({ baseUrl, fetch: fetcher });
  const invoke = client.listOrganizations as (input: unknown) => Promise<ApiClientResult<unknown>>;
  expect(await invoke({ query })).toEqual({ ok: false, error: { kind: 'request' } });
  expect(fetcher).not.toHaveBeenCalled();
});

it('rejects accessors and raw exceptions without invoking getters or leaking data', async () => {
  const getter = vi.fn(() => { throw new Error('SYNTHETIC_PRIVATE_CANARY'); });
  const fetcher = reply({}); const client = createApiClient({ baseUrl, fetch: fetcher });
  const invoke = client.getOrganization as (input: unknown) => Promise<ApiClientResult<unknown>>;
  const top = Object.defineProperty({}, 'params', { get: getter });
  const nested = { params: Object.defineProperty({}, 'organizationId', { get: getter, enumerable: true }) };
  const proxy = new Proxy({}, { ownKeys: () => { throw new Error('SYNTHETIC_PRIVATE_CANARY'); } });
  for (const input of [top, nested, proxy]) expect(await invoke(input)).toEqual({ ok: false, error: { kind: 'request' } });
  expect(getter).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
});

it('bounds snapshots and rejects invalid body values without starting a mutation', async () => {
  const fetcher = reply({}); const client = createApiClient({ baseUrl, fetch: fetcher, maximumBytes: 256 });
  const body = await load('create-organization', 'CreateOrganizationRequest');
  expect(await client.createOrganization({ body: { ...body, name: 'x'.repeat(300) } })).toEqual({ ok: false, error: { kind: 'request' } });
  expect(await client.createOrganization({ body: { ...body, requestId: 'bad' } })).toEqual({ ok: false, error: { kind: 'request' } });
  expect(fetcher).not.toHaveBeenCalled();
});

it('snapshots route and body before asynchronous fetch so caller mutation cannot relabel ownership', async () => {
  const workspace = await load('workspace', 'Workspace');
  const body = await load('patch-workspace', 'PatchWorkspaceRequest');
  const original = structuredClone(body);
  const route = { ...params };
  const fetcher = reply(workspace); const client = createApiClient({ baseUrl, fetch: fetcher });
  const pending = client.patchWorkspace({ params: route, body });
  route.organizationId = 'different'; body.scope.organizationId = 'different'; body.name = 'changed';
  expect(await pending).toEqual({ ok: true, value: workspace });
  expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body))).toEqual(original);
  expect(String(fetcher.mock.calls[0]![0])).toContain(organizationId);
});

it('preserves structural protocol errors and rejects untrusted error bodies safely', async () => {
  const error = await load('safe-error', 'ApiError');
  const fetcher = reply(error, 409); const client = createApiClient({ baseUrl, fetch: fetcher });
  expect(await client.getOrganization({ params: { organizationId } })).toEqual({ ok: false, error: { kind: 'protocol', status: 409, protocol: error } });
  fetcher.mockResolvedValueOnce(Response.json({ ...error, message: 'SYNTHETIC_PRIVATE_CANARY' }, { status: 500 }));
  const bad = await client.getOrganization({ params: { organizationId } });
  expect(bad).toMatchObject({ ok: false, error: { kind: 'response', status: 500 } });
  expect(JSON.stringify(bad)).not.toContain('SYNTHETIC_PRIVATE_CANARY');
});

it('does not retry failed mutations and distinguishes caller cancellation from deadlines', async () => {
  const body = await load('create-organization', 'CreateOrganizationRequest');
  const failed = vi.fn<typeof fetch>(async () => { throw new Error('SYNTHETIC_PRIVATE_CANARY'); });
  expect(await createApiClient({ baseUrl, fetch: failed }).createOrganization({ body })).toEqual({ ok: false, error: { kind: 'transport' } });
  expect(failed).toHaveBeenCalledTimes(1);
  const hanging = vi.fn<typeof fetch>(() => new Promise(() => undefined));
  const controller = new AbortController();
  const pending = createApiClient({ baseUrl, fetch: hanging }).createOrganization({ body, signal: controller.signal });
  controller.abort();
  expect(await pending).toEqual({ ok: false, error: { kind: 'cancelled' } });
  expect(await createApiClient({ baseUrl, fetch: hanging, timeoutMs: 5 }).createOrganization({ body }))
    .toEqual({ ok: false, error: { kind: 'timeout' } });
  expect(hanging).toHaveBeenCalledTimes(2);
});
