import { expect, it } from 'vitest';
import { createApiClient, validateApi } from '../../../src/api/index.js';
import { baseUrl, load, reply } from './helpers.js';

const ids = {
  organization: 'abcdefab-cdef-4abc-8def-abcdefabcde1',
  workspace: 'abcdefab-cdef-4abc-8def-abcdefabcde2',
  folder: 'abcdefab-cdef-4abc-8def-abcdefabcde3',
  request: 'abcdefab-cdef-4abc-8def-abcdefabcde4',
  settings: 'abcdefab-cdef-4abc-8def-abcdefabcde5',
  snapshot: 'abcdefab-cdef-4abc-8def-abcdefabcde6',
  other: 'abcdefab-cdef-4abc-8def-abcdefabcde9',
};
const organization = { kind: 'organization' as const, organizationId: ids.organization };
const workspace = { kind: 'workspace' as const, organizationId: ids.organization, workspaceId: ids.workspace };

it.each([false, true])('accepts mixed-case organization entity identity without rewriting either representation: %s', async uppercaseReply => {
  const data = await load('organization', 'Organization');
  data.id = uppercaseReply ? ids.organization.toUpperCase() : ids.organization;
  const organizationId = uppercaseReply ? ids.organization : ids.organization.toUpperCase();
  expect(validateApi('OrganizationParams', { organizationId }).ok).toBe(true);
  expect(validateApi('Organization', data).ok).toBe(true);
  const fetcher = reply(data); const client = createApiClient({ baseUrl, fetch: fetcher });
  expect(await client.getOrganization({ params: { organizationId } })).toEqual({ ok: true, value: data });
  expect(new URL(String(fetcher.mock.calls[0]![0])).pathname).toBe(`/api/v2/organizations/${organizationId}`);
});

it('accepts mixed-case route/body/response ownership while preserving request and response text', async () => {
  const body = await load('create-workspace', 'CreateWorkspaceRequest');
  body.scope = organization; body.name = 'MiXeD workspace'; body.requestId = ids.request.toUpperCase();
  const original = structuredClone(body);
  const data = await load('workspace', 'Workspace');
  data.scope = { kind: 'organization', organizationId: ids.organization.toUpperCase() }; data.name = 'RePlY workspace';
  const fetcher = reply(data, 201); const client = createApiClient({ baseUrl, fetch: fetcher });
  expect(await client.createWorkspace({ params: { organizationId: ids.organization.toUpperCase() }, body })).toEqual({ ok: true, value: data });
  expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body))).toEqual(original);
  expect(body).toEqual(original);
});

it('accepts mixed-case workspace route identity and its organization owner', async () => {
  const data = await load('workspace', 'Workspace'); data.id = ids.workspace; data.scope = organization;
  const fetcher = reply(data); const client = createApiClient({ baseUrl, fetch: fetcher });
  expect(await client.getWorkspace({ params: { organizationId: ids.organization.toUpperCase(), workspaceId: ids.workspace.toUpperCase() } }))
    .toEqual({ ok: true, value: data });
});

it('accepts mixed-case folder identity and route/body workspace ownership', async () => {
  const body = await load('patch-folder', 'PatchFolderRequest'); body.scope = workspace;
  const data = await load('folder', 'Folder'); data.id = ids.folder;
  data.scope = { ...workspace, workspaceId: ids.workspace.toUpperCase() };
  const fetcher = reply(data); const client = createApiClient({ baseUrl, fetch: fetcher });
  expect(await client.patchFolder({ params: { organizationId: ids.organization.toUpperCase(), id: ids.folder.toUpperCase() }, body }))
    .toEqual({ ok: true, value: data });
});

it('accepts mixed-case page envelope/item scopes and preserves opaque cursor contents', async () => {
  const data = await load('folder-page', 'FolderPage'); data.scope = workspace;
  data.items[0]!.scope = { ...workspace, organizationId: ids.organization.toUpperCase(), workspaceId: ids.workspace.toUpperCase() };
  data.items[0]!.name = 'CaSe SeNsItIvE'; data.nextCursor = 'RePlY_cursor-Z';
  const fetcher = reply(data); const client = createApiClient({ baseUrl, fetch: fetcher });
  expect(await client.listFolders({ params: { organizationId: ids.organization.toUpperCase(), workspaceId: ids.workspace.toUpperCase() },
    query: { limit: 25, cursor: 'ReQuEsT_cursor-A' } })).toEqual({ ok: true, value: data });
  expect(new URL(String(fetcher.mock.calls[0]![0])).searchParams.get('cursor')).toBe('ReQuEsT_cursor-A');
});

it.each(['id', 'requestId'] as const)('compares deletion receipt %s case-insensitively', async field => {
  const body = await load('delete-folder', 'DeleteFolderRequest'); body.scope = workspace; body.requestId = ids.request;
  const data = await load('deletion-receipt', 'DeletionReceipt'); data.id = ids.folder; data.scope = workspace; data.requestId = ids.request;
  data[field] = data[field].toUpperCase();
  const fetcher = reply(data); const client = createApiClient({ baseUrl, fetch: fetcher });
  expect(await client.deleteFolder({ params: { organizationId: ids.organization, id: ids.folder }, body })).toEqual({ ok: true, value: data });
});

it.each(['requestId', 'settingsId', 'snapshotId'] as const)('compares retention receipt %s case-insensitively without rewriting it', async field => {
  const body = await load('retention-apply-request', 'RetentionApplyRequest');
  body.scope = organization; body.requestId = ids.request; body.settingsId = ids.settings; body.snapshotId = ids.snapshot;
  const data = await load('retention-apply-receipt', 'RetentionApplyReceipt');
  data.scope = organization; data.requestId = ids.request; data.settingsId = ids.settings; data.snapshotId = ids.snapshot;
  data[field] = data[field].toUpperCase();
  const original = structuredClone(body);
  const fetcher = reply(data, 202); const client = createApiClient({ baseUrl, fetch: fetcher });
  expect(await client.applyOrganizationRetention({ params: { organizationId: ids.organization }, body })).toEqual({ ok: true, value: data });
  expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body))).toEqual(original);
  expect(body).toEqual(original);
});

it('accepts mixed-case retention candidate workspace descendants', async () => {
  const body = await load('retention-preview-request', 'RetentionPreviewRequest'); body.scope = workspace;
  const data = await load('retention-preview', 'RetentionPreview'); data.scope = workspace;
  data.candidates[0]!.scope = { ...workspace, organizationId: ids.organization.toUpperCase(), workspaceId: ids.workspace.toUpperCase() };
  const fetcher = reply(data); const client = createApiClient({ baseUrl, fetch: fetcher });
  expect(await client.previewOrganizationRetention({ params: { organizationId: ids.organization }, body })).toEqual({ ok: true, value: data });
});

it('accepts mixed-case effective organization/workspace source ancestors', async () => {
  const data = await load('workspace-settings', 'WorkspaceSettings'); data.scope = workspace;
  data.effective.runDefaults.engineProfile.source = { kind: 'organization', organizationId: ids.organization.toUpperCase() };
  data.effective.retention.source = { ...workspace, organizationId: ids.organization.toUpperCase(), workspaceId: ids.workspace.toUpperCase() };
  for (const leaf of Object.values(data.effective.runDefaults.budget)) leaf.source = data.effective.retention.source;
  const fetcher = reply(data); const client = createApiClient({ baseUrl, fetch: fetcher });
  expect(await client.getWorkspaceSettings({ params: { organizationId: ids.organization, workspaceId: ids.workspace } })).toEqual({ ok: true, value: data });
});

it.each(['id', 'requestId'] as const)('still rejects a genuinely different deletion receipt %s', async field => {
  const body = await load('delete-folder', 'DeleteFolderRequest'); body.scope = workspace; body.requestId = ids.request;
  const data = await load('deletion-receipt', 'DeletionReceipt'); data.id = ids.folder; data.scope = workspace; data.requestId = ids.request;
  data[field] = ids.other.toUpperCase();
  const fetcher = reply(data); const client = createApiClient({ baseUrl, fetch: fetcher });
  expect(await client.deleteFolder({ params: { organizationId: ids.organization, id: ids.folder }, body })).toEqual({ ok: false, error: { kind: 'response' } });
});

it('keeps truly different UUID route/body ownership invalid despite case differences', async () => {
  const body = await load('create-workspace', 'CreateWorkspaceRequest'); body.scope = organization;
  const fetcher = reply({}); const client = createApiClient({ baseUrl, fetch: fetcher });
  expect(await client.createWorkspace({ params: { organizationId: ids.other.toUpperCase() }, body })).toEqual({ ok: false, error: { kind: 'request' } });
  expect(fetcher).not.toHaveBeenCalled();
});

it('does not alias URN-prefixed and unprefixed UUID identities', async () => {
  const urn = `urn:uuid:${ids.organization}`;
  expect(validateApi('Uuid', urn).ok).toBe(true);
  expect(validateApi('Uuid', ids.organization).ok).toBe(true);
  const data = await load('organization', 'Organization'); data.id = ids.organization;
  const fetcher = reply(data); const client = createApiClient({ baseUrl, fetch: fetcher });
  expect(await client.getOrganization({ params: { organizationId: urn } })).toEqual({ ok: false, error: { kind: 'response' } });
  const body = await load('create-workspace', 'CreateWorkspaceRequest'); body.scope = organization;
  expect(await client.createWorkspace({ params: { organizationId: urn }, body })).toEqual({ ok: false, error: { kind: 'request' } });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('preserves protocol error UUID casing and exact static protocol strings', async () => {
  const data = await load('safe-error', 'ApiError'); data.requestId = ids.request.toUpperCase();
  const fetcher = reply(data, 409); const client = createApiClient({ baseUrl, fetch: fetcher });
  expect(await client.getOrganization({ params: { organizationId: ids.organization } }))
    .toEqual({ ok: false, error: { kind: 'protocol', status: 409, protocol: data } });
});
