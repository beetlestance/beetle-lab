import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { createFolder, scope, seed, storageFixture, uuid } from './fixture.js';

const fixture = storageFixture();
describe('bounded scoped read facade', () => {
  it('paginates stable IDs across restart and binds opaque cursors to the full scoped query', async () => {
    const path = fixture.path(); let metadata = await fixture.open(path); await seed(metadata); await seed(metadata, 20, 21, 22);
    for (let id = 1000; id < 1103; id++) await createFolder(metadata, id);
    const query = { kind: 'folder' as const, scope, parentFolderId: uuid(3), limit: 100 };
    const first = await metadata.list(query);
    expect(first.items).toHaveLength(100); expect(first.nextCursor).toBeTypeOf('string');
    expect(first.items[0]?.id).toBe(uuid(1000));
    await fixture.close(metadata); metadata = await fixture.open(path);
    const last = await metadata.list({ ...query, cursor: first.nextCursor! });
    expect(last.items).toHaveLength(3); expect(last.nextCursor).toBeNull();
    expect(new Set([...first.items, ...last.items].map(entity => entity.id)).size).toBe(103);
    await expect(metadata.list({ ...query, limit: 1, cursor: first.nextCursor! })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(metadata.list({ ...query, scope: { ...scope, organizationId: uuid(20), workspaceId: uuid(21) },
      parentFolderId: uuid(22), cursor: first.nextCursor! })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(metadata.list({ ...query, parentFolderId: uuid(1000), cursor: first.nextCursor! })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(metadata.list({ ...query, cursor: 'malformed-CANARY' })).rejects.toMatchObject({ code: 'invalid_input', message: 'Storage invalid_input' });
    expect((await metadata.list(query)).items).toHaveLength(100);
  });
  it('requires scope and exact parent identity, bounds pages and never returns mixed owners', async () => {
    const metadata = await fixture.open(); await seed(metadata); await seed(metadata, 20, 21, 22);
    await createFolder(metadata, 4);
    const organizations = await metadata.list({ kind: 'organization', scope: { kind: 'installation' }, limit: 100 });
    expect(organizations.items.map(entity => entity.id)).toEqual([uuid(1), uuid(20)]);
    const workspaces = await metadata.list({ kind: 'workspace', scope: { kind: 'organization', organizationId: uuid(20) }, limit: 100 });
    expect(workspaces.items.map(entity => entity.id)).toEqual([uuid(21)]);
    const query = { kind: 'folder' as const, scope, parentFolderId: uuid(3), limit: 100 };
    for (const limit of [0, 101, 1.1]) await expect(metadata.list({ ...query, limit })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(metadata.list({ ...query, parentFolderId: uuid(22) })).rejects.toMatchObject({ code: 'not_found' });
    expect((await metadata.list({ kind: 'folder', scope, limit: 100 })).items.map(entity => entity.id)).toEqual([uuid(3), uuid(4)]);
    await expect(metadata.get({ kind: 'folder', scope: { kind: 'installation' }, id: uuid(4) })).rejects.toMatchObject({ code: 'invalid_input' });
  });
  it('uses bounded indexed list and parent/subtree lookups on representative sibling data', async () => {
    const path = fixture.path(); const metadata = await fixture.open(path); await seed(metadata);
    for (let id = 1000; id < 1105; id++) await createFolder(metadata, id);
    await fixture.close(metadata);
    const db = new DatabaseSync(path);
    try {
      const folders = db.prepare(`EXPLAIN QUERY PLAN SELECT id FROM folders
        WHERE organization_id=? AND workspace_id=? AND parent_id=? AND id>? ORDER BY id LIMIT ?`)
        .all(uuid(1), uuid(2), uuid(3), '', 101);
      const workspaces = db.prepare(`EXPLAIN QUERY PLAN SELECT id FROM workspaces
        WHERE organization_id=? AND id>? ORDER BY id LIMIT ?`).all(uuid(1), '', 101);
      const parents = db.prepare(`EXPLAIN QUERY PLAN SELECT id FROM folders
        WHERE organization_id=? AND workspace_id=? AND id=?`).all(uuid(1), uuid(2), uuid(3));
      const flat = db.prepare(`EXPLAIN QUERY PLAN SELECT id FROM folders
        WHERE organization_id=? AND workspace_id=? AND id>? ORDER BY id LIMIT ?`).all(uuid(1), uuid(2), '', 101);
      for (const plan of [folders, workspaces, parents, flat]) {
        expect(plan.map(row => row.detail).join(' ')).toMatch(/SEARCH .*USING .*INDEX/);
        expect(plan.map(row => row.detail).join(' ')).not.toContain('TEMP B-TREE');
      }
      expect(folders.map(row => row.detail).join(' ')).toContain('folders_children');
      expect(flat.map(row => row.detail).join(' ')).toContain('folders_page');
    } finally { db.close(); }
  });
  it('pages flat workspace folders across different parents with bounded derived paths and mode-bound cursors', async () => {
    const metadata = await fixture.open(); await seed(metadata); await seed(metadata, 20, 21, 22);
    const parent = await createFolder(metadata, 4); await createFolder(metadata, 5, parent.id);
    await createFolder(metadata, 6); await createFolder(metadata, 23, uuid(22), {
      kind: 'workspace', organizationId: uuid(20), workspaceId: uuid(21) });
    const query = { kind: 'folder' as const, scope, limit: 2 };
    const first = await metadata.list(query); const second = await metadata.list({ ...query, cursor: first.nextCursor! });
    expect(first.items.map(entity => entity.id)).toEqual([uuid(3), uuid(4)]);
    expect(second.items.map(entity => entity.id)).toEqual([uuid(5), uuid(6)]);
    expect(second.items[0]).toMatchObject({ displayPath: ['Project', 'Folder 4', 'Folder 5'] });
    expect(second.nextCursor).toBeNull();
    await expect(metadata.list({ ...query, parentFolderId: uuid(3), cursor: first.nextCursor! }))
      .rejects.toMatchObject({ code: 'invalid_input' });
    await expect(metadata.list({ ...query, scope: { ...scope, organizationId: uuid(20), workspaceId: uuid(21) },
      cursor: first.nextCursor! })).rejects.toMatchObject({ code: 'invalid_input' });
    const children = await metadata.list({ ...query, parentFolderId: uuid(3), limit: 1 });
    await expect(metadata.list({ ...query, limit: 1, cursor: children.nextCursor! }))
      .rejects.toMatchObject({ code: 'invalid_input' });
  });
});
