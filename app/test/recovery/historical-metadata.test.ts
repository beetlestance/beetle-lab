import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { command, requestId, seed, storageFixture, uuid } from '../storage/fixture.js';
import { initializeHistorical } from '../../src/adapters/outbound/sqlite/schema.js';
const f = storageFixture();
const hash = async (path: string) => createHash('sha256').update(await readFile(path)).digest('hex');
it('reads namespaces/history through the real read-only worker and forbids private mutations/replay/auth', async () => {
  const path = f.path(); const source = await f.open(path); const {organization, workspace} = await seed(source); await f.close(source);
  const before = await hash(path); const archive = await f.open(path, {readOnly: true, runtime: null});
  expect(await archive.get({kind: 'organization', scope: {kind: 'installation'}, id: organization.id})).toEqual(organization);
  const scope = {kind: 'workspace' as const, organizationId: organization.id, workspaceId: workspace.id};
  expect((await archive.runs.listRuns({scope, limit: 10})).items).toEqual([]);
  await expect(archive.namespaces.execute(command({kind: 'createOrganization', id: uuid(40), request: {
    scope: {kind: 'installation'}, requestId: requestId(), name: 'Forbidden', slug: 'forbidden'}}))).rejects.toMatchObject({code: 'read_only'});
  await expect(archive.localSessions.load()).rejects.toMatchObject({code: 'read_only'});
  await expect(archive.updateRuntime(null)).rejects.toMatchObject({code: 'read_only'});
  await f.close(archive); expect(await hash(path)).toBe(before);
});
it('native query-only/readOnly protection refuses bypass writes and never migrates an older archive', async () => {
  const path = f.path(); const source = await f.open(path); await f.close(source); const db = initializeHistorical(path);
  try {expect(() => db.exec('DELETE FROM settings')).toThrow(); expect(db.prepare('PRAGMA query_only').get()?.query_only).toBe(1);}
  finally {db.close();}
  const writable = new DatabaseSync(path); writable.exec('PRAGMA user_version=26;'); writable.close(); const before = await hash(path);
  expect(() => initializeHistorical(path)).toThrow('schema_newer'); expect(await hash(path)).toBe(before);
});
