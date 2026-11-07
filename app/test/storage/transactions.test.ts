import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { command, createFolder, requestId, scope, seed, settingsCommand, storageFixture, uuid } from './fixture.js';

const fixture = storageFixture();
describe('real SQLite atomicity and schema constraints', () => {
  it('refuses future schemas without changing persisted bytes and rolls back a failing migration', async () => {
    const future = fixture.path(); const db = new DatabaseSync(future);
    db.exec("CREATE TABLE canary(value TEXT); INSERT INTO canary VALUES ('safe'); PRAGMA user_version=99;"); db.close();
    const bytes = await readFile(future);
    await expect(fixture.open(future)).rejects.toMatchObject({ code: 'schema_newer' });
    expect(await readFile(future)).toEqual(bytes);
    const broken = fixture.path(); const collision = new DatabaseSync(broken);
    collision.exec("CREATE TABLE folders(canary TEXT); INSERT INTO folders VALUES ('safe');"); collision.close();
    await expect(fixture.open(broken)).rejects.toMatchObject({ code: 'unavailable' });
    const inspection = new DatabaseSync(broken);
    try {
      expect(inspection.prepare('PRAGMA user_version').get()?.user_version).toBe(0);
      expect(inspection.prepare("SELECT name FROM sqlite_master WHERE name='organizations'").get()).toBeUndefined();
      expect(inspection.prepare('SELECT canary FROM folders').get()?.canary).toBe('safe');
    } finally { inspection.close(); }
  });
  it('rolls back organization/override and workspace/root creation when receipt insertion fails', async () => {
    const path = fixture.path(); let metadata = await fixture.open(path); await fixture.close(metadata);
    const db = new DatabaseSync(path);
    db.exec("CREATE TRIGGER fail_receipt BEFORE INSERT ON receipts BEGIN SELECT RAISE(ABORT,'synthetic fault'); END;"); db.close();
    metadata = await fixture.open(path);
    const organization = command({ kind: 'createOrganization', id: uuid(1), request: {
      requestId: requestId(), scope: { kind: 'installation' }, name: 'Team', slug: 'team' } });
    await expect(metadata.namespaces.execute(organization)).rejects.toMatchObject({ code: 'conflict' });
    await fixture.close(metadata);
    const inspect = new DatabaseSync(path);
    try {
      expect(inspect.prepare('SELECT count(*) AS n FROM organizations').get()?.n).toBe(0);
      expect(inspect.prepare('SELECT count(*) AS n FROM settings').get()?.n).toBe(1);
      expect(inspect.prepare('SELECT count(*) AS n FROM receipts').get()?.n).toBe(0);
      inspect.exec('DROP TRIGGER fail_receipt');
    } finally { inspect.close(); }
    metadata = await fixture.open(path); await metadata.namespaces.execute(organization); await fixture.close(metadata);
    const fault = new DatabaseSync(path);
    fault.exec("CREATE TRIGGER fail_receipt BEFORE INSERT ON receipts BEGIN SELECT RAISE(ABORT,'synthetic fault'); END;"); fault.close();
    metadata = await fixture.open(path);
    await expect(metadata.namespaces.execute(command({ kind: 'createWorkspace', id: uuid(2), rootFolderId: uuid(3), request: {
      requestId: requestId(), scope: { kind: 'organization', organizationId: uuid(1) }, name: 'Project' } })))
      .rejects.toMatchObject({ code: 'conflict' });
    await fixture.close(metadata);
    const check = new DatabaseSync(path);
    try {
      for (const table of ['workspaces', 'folders']) expect(check.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n).toBe(0);
      expect(check.prepare('SELECT count(*) AS n FROM settings').get()?.n).toBe(2);
      expect(check.prepare('SELECT count(*) AS n FROM receipts').get()?.n).toBe(1);
    } finally { check.close(); }
  });
  it('rolls back settings value/version updates together with receipts and permits exact retry', async () => {
    const path = fixture.path(); let metadata = await fixture.open(path); await seed(metadata);
    const settings = await metadata.getSettings(scope); await fixture.close(metadata);
    const db = new DatabaseSync(path);
    db.exec("CREATE TRIGGER fail_receipt BEFORE INSERT ON receipts BEGIN SELECT RAISE(ABORT,'synthetic fault'); END;"); db.close();
    metadata = await fixture.open(path);
    const change = settingsCommand(settings.id, { schemaVersion: 2, scope, requestId: requestId(), expectedVersion: 1,
      patch: { runDefaults: { budget: { cpuMillis: 200 } } } });
    await expect(metadata.settings.execute(change)).rejects.toMatchObject({ code: 'conflict' });
    expect(await metadata.getSettings(scope)).toEqual(settings); await fixture.close(metadata);
    const repair = new DatabaseSync(path); repair.exec('DROP TRIGGER fail_receipt'); repair.close();
    metadata = await fixture.open(path);
    expect((await metadata.settings.execute(change)).settings.version).toBe(2);
  });
  it('enforces composite foreign keys and a single genuine root independently of facade checks', async () => {
    const path = fixture.path(); const metadata = await fixture.open(path); await seed(metadata); await seed(metadata, 20, 21, 22);
    await fixture.close(metadata);
    const db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
    try {
      const insert = db.prepare('INSERT INTO folders(id,organization_id,workspace_id,parent_id,version,name,folded_name) VALUES (?,?,?,?,1,?,?)');
      expect(() => insert.run(uuid(30), uuid(1), uuid(2), uuid(22), 'bad', 'bad')).toThrow();
      expect(() => insert.run(uuid(31), uuid(20), uuid(2), uuid(3), 'bad', 'bad')).toThrow();
      expect(() => insert.run(uuid(32), uuid(1), uuid(2), null, 'second root', 'second root')).toThrow();
      expect(() => db.prepare('UPDATE folders SET parent_id=? WHERE id=?').run(uuid(22), uuid(3))).toThrow();
      expect(() => db.prepare(`INSERT INTO settings(scope_key,id,kind,organization_id,workspace_id,version,value_json)
        VALUES (?,?,?,?,?,1,'{}')`).run(`workspace:${uuid(20)}:${uuid(2)}`, uuid(33), 'workspace', uuid(20), uuid(2))).toThrow();
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally { db.close(); }
  });
  it('rejects subtree evidence above its node cap without materializing the full tree', async () => {
    const path = fixture.path(); let metadata = await fixture.open(path); await seed(metadata); await createFolder(metadata, 4);
    await fixture.close(metadata);
    const db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
    db.prepare(`WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<10000)
      INSERT INTO folders(id,organization_id,workspace_id,parent_id,version,name,folded_name)
      SELECT printf('00000000-0000-4000-8001-%012d',i),?,?,?,1,'child'||i,'child'||i FROM n`)
      .run(uuid(1), uuid(2), uuid(4)); db.close();
    metadata = await fixture.open(path);
    await expect(metadata.namespaces.execute(command({ kind: 'patchFolder', id: uuid(4), request: {
      requestId: requestId(), scope, expectedVersion: 1, name: 'Too large' } }))).rejects.toMatchObject({ code: 'invalid_value' });
    expect(await metadata.get({ kind: 'folder', scope, id: uuid(4) })).toMatchObject({ version: 1, name: 'Folder 4' });
  });
});
