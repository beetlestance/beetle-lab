import { describe, expect, it } from 'vitest';
import type { Folder } from '@beetle/contracts/api';
import { validateApi } from '@beetle/contracts/api';
import { command, createFolder, requestId, scope, seed, storageFixture, uuid } from './fixture.js';

const fixture = storageFixture();
describe('scoped namespace persistence', () => {
  it('creates one workspace root and empty override records atomically with API-shaped entities', async () => {
    const metadata = await fixture.open();
    const { organization, workspace } = await seed(metadata);
    const root = await metadata.get({ kind: 'folder', scope, id: workspace.rootFolderId });
    expect(validateApi('Organization', organization).ok).toBe(true);
    expect(validateApi('Workspace', workspace).ok).toBe(true);
    expect(validateApi('Folder', root).ok).toBe(true);
    expect(root).toMatchObject({ parentFolderId: null, displayPath: ['Project'] });
    expect(await metadata.getSettings(workspace.scope)).toMatchObject({ version: 1, overrides: {} });
    expect(await metadata.getSettings(scope)).toMatchObject({ version: 1, overrides: {} });
    expect((await metadata.list({ kind: 'folder', scope, parentFolderId: uuid(3), limit: 100 })).items).toEqual([]);
  });
  it('replays original CREATE IDs/root with fresh allocations after restart and conflicts on changed intent', async () => {
    const path = fixture.path(); let metadata = await fixture.open(path);
    const first = command({ kind: 'createOrganization', id: uuid(1), request: {
      requestId: requestId(), scope: { kind: 'installation' }, name: 'Team', slug: 'team' } });
    const organization = await metadata.namespaces.execute(first);
    await expect(metadata.namespaces.execute({ ...first, id: uuid(50) })).resolves.toEqual(organization);
    const workspaceCommand = command({ kind: 'createWorkspace', id: uuid(2), rootFolderId: uuid(3),
      request: { requestId: requestId(), scope: { kind: 'organization', organizationId: uuid(1) }, name: 'Project' } });
    const workspace = await metadata.namespaces.execute(workspaceCommand);
    await fixture.close(metadata); metadata = await fixture.open(path);
    await expect(metadata.namespaces.execute({ ...workspaceCommand, id: uuid(60), rootFolderId: uuid(61) })).resolves.toEqual(workspace);
    const changed = command({ ...workspaceCommand, request: { ...workspaceCommand.request, name: 'Changed' } });
    await expect(metadata.namespaces.execute(changed)).rejects.toMatchObject({ code: 'conflict' });
    const page = await metadata.list({ kind: 'workspace', scope: workspaceCommand.request.scope, limit: 100 });
    expect(page.items).toEqual([workspace]);
    await expect(metadata.get({ kind: 'folder', scope, id: uuid(61) })).rejects.toMatchObject({ code: 'not_found' });
  });
  it('uses scoped parent reads and mutations and folded uniqueness within owners', async () => {
    const metadata = await fixture.open(); await seed(metadata); await seed(metadata, 20, 21, 22);
    const folder = await createFolder(metadata, 4, uuid(3), scope, ' Test ');
    const otherScope = { ...scope, organizationId: uuid(20), workspaceId: uuid(21) };
    await createFolder(metadata, 23, uuid(22), otherScope, 'Test');
    await expect(createFolder(metadata, 5, uuid(3), scope, 'ＴＥＳＴ')).rejects.toMatchObject({ code: 'conflict' });
    await expect(metadata.get({ kind: 'folder', scope: otherScope, id: folder.id })).rejects.toMatchObject({ code: 'not_found' });
    await expect(createFolder(metadata, 6, uuid(22))).rejects.toMatchObject({ code: 'not_found' });
    await expect(metadata.namespaces.execute(command({ kind: 'patchFolder', id: folder.id, request: {
      requestId: requestId(), scope: otherScope, expectedVersion: 1, name: 'bad' } }))).rejects.toMatchObject({ code: 'not_found' });
    await expect(metadata.get({ kind: 'workspace', scope: { kind: 'organization', organizationId: uuid(20) }, id: uuid(2) }))
      .rejects.toMatchObject({ code: 'not_found' });
    await expect(metadata.namespaces.execute(command({ kind: 'createWorkspace', id: uuid(7), rootFolderId: uuid(8), request: {
      requestId: requestId(), scope: { kind: 'organization', organizationId: uuid(1) }, name: 'ＰＲＯＪＥＣＴ' } })))
      .rejects.toMatchObject({ code: 'conflict' });
    await expect(metadata.namespaces.execute(command({ kind: 'createOrganization', id: uuid(9), request: {
      requestId: requestId(), scope: { kind: 'installation' }, name: 'Other', slug: 'org-1' } })))
      .rejects.toMatchObject({ code: 'conflict' });
  });
  it('serializes opposing moves so one cannot create a cycle and derives descendant paths', async () => {
    const metadata = await fixture.open(); await seed(metadata);
    const a = await createFolder(metadata, 4); const b = await createFolder(metadata, 5);
    const child = await createFolder(metadata, 6, a.id);
    const moves = [a, b].map((folder, index) => metadata.namespaces.execute(command({ kind: 'patchFolder', id: folder.id,
      request: { requestId: requestId(), scope, expectedVersion: 1, parentFolderId: index === 0 ? b.id : a.id } })));
    const results = await Promise.allSettled(moves);
    expect(results.map(value => value.status).sort()).toEqual(['fulfilled', 'rejected']);
    const moved = await metadata.get({ kind: 'folder', scope, id: child.id }) as Folder;
    expect(moved.displayPath).toEqual(['Project', 'Folder 5', 'Folder 4', 'Folder 6']);
    await expect(metadata.namespaces.execute(command({ kind: 'patchFolder', id: a.id, request: {
      requestId: requestId(), scope, expectedVersion: 1, name: 'stale' } }))).rejects.toMatchObject({ code: 'conflict' });
    await metadata.namespaces.execute(command({ kind: 'patchFolder', id: b.id, request: {
      requestId: requestId(), scope, expectedVersion: 1, name: 'Renamed' } }));
    expect(await metadata.get({ kind: 'folder', scope, id: child.id })).toMatchObject({ displayPath: ['Project', 'Renamed', 'Folder 4', 'Folder 6'] });
  });
  it('enforces depth including moved descendants and preserves immutable root ownership', async () => {
    const metadata = await fixture.open(); await seed(metadata);
    let parent = uuid(3);
    for (let i = 4; i <= 10; i++) parent = (await createFolder(metadata, i, parent)).id;
    await expect(createFolder(metadata, 11, parent)).rejects.toMatchObject({ code: 'invalid_value' });
    const branch = await createFolder(metadata, 12); await createFolder(metadata, 13, branch.id);
    await expect(metadata.namespaces.execute(command({ kind: 'patchFolder', id: branch.id, request: {
      requestId: requestId(), scope, expectedVersion: 1, parentFolderId: uuid(9) } }))).rejects.toMatchObject({ code: 'invalid_value' });
    await expect(metadata.namespaces.execute(command({ kind: 'patchFolder', id: uuid(3), request: {
      requestId: requestId(), scope, expectedVersion: 1, parentFolderId: branch.id } }))).rejects.toMatchObject({ code: 'invalid_value' });
    await metadata.namespaces.execute(command({ kind: 'patchFolder', id: uuid(3), request: {
      requestId: requestId(), scope, expectedVersion: 1, name: 'Root renamed' } }));
    expect(await metadata.get({ kind: 'folder', scope, id: parent })).toMatchObject({ displayPath: [
      'Root renamed', ...Array.from({ length: 7 }, (_, index) => `Folder ${index + 4}`)] });
  });
  it('canonicalizes UUID case without aliasing UUID URNs and verifies SHA256 at the boundary', async () => {
    const metadata = await fixture.open();
    const id = 'ABCDEFAB-0000-4000-8000-000000000001';
    const original = command({ kind: 'createOrganization', id, request: {
      requestId: requestId(), scope: { kind: 'installation' }, name: 'Bare', slug: 'bare' } });
    expect(await metadata.namespaces.execute(original)).toMatchObject({ id: id.toLowerCase() });
    expect(await metadata.get({ kind: 'organization', scope: { kind: 'installation' }, id })).toMatchObject({ id: id.toLowerCase() });
    await expect(metadata.get({ kind: 'organization', scope: { kind: 'installation' }, id: `urn:uuid:${id}` }))
      .rejects.toMatchObject({ code: 'not_found' });
    const urn = await metadata.namespaces.execute(command({ kind: 'createOrganization', id: `URN:UUID:${id}`, request: {
      requestId: requestId(), scope: { kind: 'installation' }, name: 'URN', slug: 'urn' } }));
    expect(urn.id).toBe(`urn:uuid:${id.toLowerCase()}`);
    await expect(metadata.namespaces.execute({ ...original, intentDigest: '0'.repeat(64) })).rejects.toMatchObject({ code: 'invalid_input' });
  });
});
