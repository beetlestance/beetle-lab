import { expect, it } from 'vitest';
import { createApiClient } from '../../../src/api/index.js';
import { baseUrl, load, organizationId, otherId, params, reply, workspaceId } from './helpers.js';

it('rejects wrong route/body organizations and workspaces before fetch', async () => {
  const fetcher = reply({}); const client = createApiClient({ baseUrl, fetch: fetcher });
  const workspace = await load('create-workspace', 'CreateWorkspaceRequest');
  const folder = await load('create-folder', 'CreateFolderRequest');
  expect(await client.createWorkspace({ params: { organizationId: otherId }, body: workspace })).toEqual({ ok: false, error: { kind: 'request' } });
  expect(await client.createFolder({ params: { ...params, workspaceId: otherId }, body: folder })).toEqual({ ok: false, error: { kind: 'request' } });
  const settings = await load('patch-workspace-settings', 'PatchWorkspaceSettingsRequest');
  expect(await client.patchWorkspaceSettings({ params: { ...params, organizationId: otherId }, body: settings })).toEqual({ ok: false, error: { kind: 'request' } });
  expect(fetcher).not.toHaveBeenCalled();
});

it('checks organization entity id rather than its installation owner or settings record id', async () => {
  const organization = await load('organization', 'Organization');
  const fetcher = reply({ ...organization, id: otherId });
  const client = createApiClient({ baseUrl, fetch: fetcher });
  expect(await client.getOrganization({ params: { organizationId } })).toEqual({ ok: false, error: { kind: 'response' } });
  const settings = await load('organization-settings', 'OrganizationSettings');
  expect(settings.id).not.toBe(organizationId);
  fetcher.mockResolvedValueOnce(Response.json(settings));
  expect(await client.getOrganizationSettings({ params: { organizationId } })).toEqual({ ok: true, value: settings });
});

it('checks returned workspace identity and owner independently', async () => {
  const workspace = await load('workspace', 'Workspace');
  const fetcher = reply({ ...workspace, scope: { kind: 'organization', organizationId: otherId } });
  const client = createApiClient({ baseUrl, fetch: fetcher });
  expect(await client.getWorkspace({ params })).toEqual({ ok: false, error: { kind: 'response' } });
  fetcher.mockResolvedValueOnce(Response.json({ ...workspace, id: otherId }));
  expect(await client.getWorkspace({ params })).toEqual({ ok: false, error: { kind: 'response' } });
});

it('checks folder path identity and binds returned workspace to the request body', async () => {
  const body = await load('patch-folder', 'PatchFolderRequest');
  const folder = await load('folder', 'Folder');
  const path = await load('folder-params', 'FolderParams');
  const fetcher = reply({ ...folder, id: otherId });
  const client = createApiClient({ baseUrl, fetch: fetcher });
  expect(await client.patchFolder({ params: path, body })).toEqual({ ok: false, error: { kind: 'response' } });
  fetcher.mockResolvedValueOnce(Response.json({ ...folder, scope: { ...folder.scope, workspaceId: otherId } }));
  expect(await client.patchFolder({ params: path, body })).toEqual({ ok: false, error: { kind: 'response' } });
});

it('checks every page item as well as its envelope', async () => {
  const page = await load('workspace-page', 'WorkspacePage');
  const fetcher = reply({ ...page, items: [page.items[0], { ...page.items[0], scope: { kind: 'organization', organizationId: otherId } }] });
  const client = createApiClient({ baseUrl, fetch: fetcher });
  expect(await client.listWorkspaces({ params: { organizationId }, query: { limit: 100 } })).toEqual({ ok: false, error: { kind: 'response' } });
  const folders = await load('folder-page', 'FolderPage');
  fetcher.mockResolvedValueOnce(Response.json({ ...folders, items: [folders.items[0], { ...folders.items[0], scope: { kind: 'workspace', organizationId, workspaceId: otherId } }] }));
  expect(await client.listFolders({ params, query: { limit: 100 } })).toEqual({ ok: false, error: { kind: 'response' } });
  fetcher.mockResolvedValueOnce(Response.json({ ...page, scope: { kind: 'organization', organizationId: otherId } }));
  expect(await client.listWorkspaces({ params: { organizationId }, query: { limit: 100 } })).toEqual({ ok: false, error: { kind: 'response' } });
});

it('requires exact parent scope for installation and organization traversal',async()=>{
 const body=await load('retention-preview-request','RetentionPreviewRequest');const data=await load('retention-traversal-page','RetentionTraversalPage');const fetcher=reply(data);const client=createApiClient({baseUrl,fetch:fetcher});
 expect(await client.previewInstallationRetention({body})).toEqual({ok:false,error:{kind:'request'}});
 expect(await client.previewOrganizationRetention({params:{organizationId:otherId},body})).toEqual({ok:false,error:{kind:'request'}});
 expect(await client.previewOrganizationRetention({params:{organizationId},body:{...body,scope:{kind:'installation'}}})).toEqual({ok:false,error:{kind:'request'}});
 expect(await client.previewOrganizationRetention({params:{organizationId},body:{...body,scope:{kind:'workspace',organizationId,workspaceId}}})).toEqual({ok:false,error:{kind:'request'}});
 expect(fetcher).not.toHaveBeenCalled();expect(await client.previewOrganizationRetention({params:{organizationId},body})).toMatchObject({ok:true});
});

it('checks every retention candidate below its preview scope without reversing ancestry', async () => {
  const body = await load('retention-preview-request', 'RetentionPreviewRequest');body.scope={kind:'workspace',organizationId,workspaceId};
  const data = await load('retention-preview', 'RetentionPreview');data.scope=body.scope;
  const fetcher = reply({ ...data, candidates: [data.candidates[0], { ...data.candidates[0], scope: { kind: 'workspace', organizationId: otherId, workspaceId } }] });
  const client = createApiClient({ baseUrl, fetch: fetcher });
  expect(await client.previewWorkspaceRetention({ params: { organizationId,workspaceId }, body })).toEqual({ ok: false, error: { kind: 'response' } });
  const scope = { kind: 'workspace' as const, organizationId, workspaceId: otherId };
  fetcher.mockResolvedValueOnce(Response.json({ ...data, scope }));
  expect(await client.previewWorkspaceRetention({ params: { organizationId,workspaceId:otherId }, body: { ...body, scope } })).toEqual({ ok: false, error: { kind: 'response' } });
});

it('binds retention response scope and intent/settings/snapshot identity', async () => {
  const body = await load('retention-apply-request', 'RetentionApplyRequest');body.scope={kind:'workspace',organizationId,workspaceId};
  const receipt = await load('retention-apply-receipt', 'RetentionApplyReceipt');receipt.scope=body.scope;
  const fetcher = reply(receipt, 202); const client = createApiClient({ baseUrl, fetch: fetcher });
  const replacements = [{ requestId: otherId }, { settingsId: otherId }, { settingsVersion: 2 }, { snapshotId: otherId }, { snapshotVersion: 2 },
    { scope: { kind: 'organization', organizationId: otherId } }];
  for (const replacement of replacements) {
    fetcher.mockResolvedValueOnce(Response.json({ ...receipt, ...replacement }, { status: 202 }));
    expect(await client.applyWorkspaceRetention({ params: { organizationId,workspaceId }, body })).toEqual({ ok: false, error: { kind: 'response' } });
  }
});

it('allows inherited settings sources from the same scope and its ancestors', async () => {
  const data = await load('workspace-settings', 'WorkspaceSettings');
  data.effective.runDefaults.engineProfile.source = { kind: 'organization', organizationId };
  data.effective.retention.source = data.scope;
  const fetcher = reply(data); const client = createApiClient({ baseUrl, fetch: fetcher });
  expect(await client.getWorkspaceSettings({ params })).toEqual({ ok: true, value: data });
});

it('rejects effective sources from a different organization/workspace or a deeper scope', async () => {
  const data = await load('workspace-settings', 'WorkspaceSettings');
  const fetcher = reply(data); const client = createApiClient({ baseUrl, fetch: fetcher });
  for (const source of [{ kind: 'organization' as const, organizationId: otherId }, { kind: 'workspace' as const, organizationId, workspaceId: otherId }]) {
    const wrong = structuredClone(data); wrong.effective.runDefaults.budget.cpuMillis.source = source;
    fetcher.mockResolvedValueOnce(Response.json(wrong));
    expect(await client.getWorkspaceSettings({ params })).toEqual({ ok: false, error: { kind: 'response' } });
  }
  const organization = await load('organization-settings', 'OrganizationSettings');
  organization.effective.retention.source = { kind: 'workspace', organizationId, workspaceId };
  fetcher.mockResolvedValueOnce(Response.json(organization));
  expect(await client.getOrganizationSettings({ params: { organizationId } })).toEqual({ ok: false, error: { kind: 'response' } });
  const installation = await load('installation-settings', 'InstallationSettings');
  installation.effective.runDefaults.engineProfile.source = { kind: 'organization', organizationId };
  fetcher.mockResolvedValueOnce(Response.json(installation));
  expect(await client.getInstallationSettings()).toEqual({ ok: false, error: { kind: 'response' } });
});
