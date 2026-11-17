import { expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import {
  captureFolderRow,
  captureOrganization,
  captureWorkspace,
  namespaceColumns,
  namespaceIdColumn,
} from '../../src/adapters/outbound/sqlite/namespace-rows.js';
import { scope, seed, storageFixture, uuid } from './fixture.js';
import { rawConnection } from './raw-connection-fixture.js';
const f = storageFixture();
const owners = [
  ['organization', 'organizations', 1],
  ['workspace', 'workspaces', 2],
  ['folder', 'folders', 3],
] as const;
function corruptName(fault: string): string | Buffer {
  switch (fault) {
    case 'empty':
      return '';
    case 'control':
      return 'PRIVATE-CANARY\u0000';
    case 'blob':
      return Buffer.from('PRIVATE-CANARY');
    case 'oversize':
      return 'PRIVATE-CANARY'.repeat(100000);
    default:
      throw Error('Unknown corrupt-name fixture');
  }
}
for (const [kind, table, id] of owners) {
  it.each(['empty', 'control', 'blob', 'oversize', 'unsafe-version', 'fractional-version'])(
    `${kind} refuses corrupt stored %s before returning an entity`,
    async (fault) => {
      const path = f.path();
      const original = await f.open(path);
      await seed(original);
      await f.close(original);
      const db = rawConnection(path);
      try {
        if (fault === 'unsafe-version')
          db.prepare(`UPDATE ${table} SET version=? WHERE id=?`).run(9007199254740992, uuid(id));
        else if (fault === 'fractional-version')
          db.prepare(`UPDATE ${table} SET version=? WHERE id=?`).run(1.5, uuid(id));
        else {
          const value = corruptName(fault);
          db.prepare(`UPDATE ${table} SET name=? WHERE id=?`).run(value, uuid(id));
          if (fault === 'blob' || fault === 'oversize') {
            const projected = db.prepare(`SELECT ${namespaceColumns(kind)} FROM ${table} WHERE id=?`).get(uuid(id));
            expect(projected?.name).toBeNull();
          }
        }
      } finally {
        db.close();
      }
      const metadata = await f.open(path);
      const key = {
        kind,
        id: uuid(id),
        scope:
          kind === 'organization'
            ? { kind: 'installation' as const }
            : kind === 'workspace'
              ? { kind: 'organization' as const, organizationId: uuid(1) }
              : scope,
      };
      await expect(metadata.get(key)).rejects.toMatchObject({ code: 'unavailable', message: 'Storage unavailable' });
    },
  );
}
it('rejects malformed identity and wrong scope instead of trusting selected row types', () => {
  const org = { id: uuid(1), version: 1, name: 'Team', slug: 'team' };
  expect(() => captureOrganization({ ...org, slug: 'Invalid Slug' }, uuid(1))).toThrow();
  expect(() => captureOrganization(org, uuid(9))).toThrow();
  const workspace = { id: uuid(2), organization_id: uuid(1), root_folder_id: uuid(3), version: 1, name: 'Project' };
  expect(() => captureWorkspace(workspace, uuid(9), uuid(2))).toThrow();
  expect(() => captureWorkspace({ ...workspace, root_folder_id: 'invalid' }, uuid(1), uuid(2))).toThrow();
  const folder = {
    id: uuid(3),
    organization_id: uuid(1),
    workspace_id: uuid(2),
    parent_id: null,
    version: 1,
    name: 'Root',
  };
  expect(() => captureFolderRow({ ...folder, workspace_id: uuid(9) }, scope)).toThrow();
  expect(() => captureFolderRow({ ...folder, parent_id: '' }, scope)).toThrow();
});
it('bounds nullable parent and identifier projections without turning corruption into a root folder', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE folders(id,organization_id,workspace_id,parent_id,name,version)');
    db.prepare('INSERT INTO folders VALUES(?,?,?,?,?,?)').run(
      'X'.repeat(100000),
      uuid(1),
      uuid(2),
      'X'.repeat(100000),
      'Root',
      1,
    );
    const row = db.prepare(`SELECT ${namespaceColumns('folder')} FROM folders`).get();
    expect(row?.id).toBeNull();
    expect(row?.parent_id).toBe('');
    expect(() => captureFolderRow(row, scope)).toThrow();
    expect(db.prepare(`SELECT ${namespaceIdColumn} FROM folders`).get()?.id).toBeNull();
  } finally {
    db.close();
  }
});

it('refuses a malformed limit-plus-one row instead of issuing a continuation cursor', async () => {
  const path = f.path();
  const original = await f.open(path);
  await seed(original);
  await f.close(original);
  const db = rawConnection(path);
  try {
    db.prepare('INSERT INTO organizations(id,version,name,slug) VALUES(?,?,?,?)').run('z'.repeat(45), 1, 'Bad', 'bad');
  } finally {
    db.close();
  }
  const metadata = await f.open(path);
  await expect(
    metadata.list({ kind: 'organization', scope: { kind: 'installation' }, limit: 1 }),
  ).rejects.toMatchObject({ code: 'unavailable' });
});
