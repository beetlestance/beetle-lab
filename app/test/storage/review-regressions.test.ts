import {withRawGuards} from './raw-connection-fixture.js';
import { registerSearchFold } from '../../src/adapters/outbound/sqlite/run-search-fold.js';
import { describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Entities } from '../../src/adapters/outbound/sqlite/entities.js';
import { RuntimeCapacity } from '../../src/adapters/outbound/sqlite/runtime.js';
import { createFolder, observation, scope, seed, settingsFixture, storageFixture, uuid } from './fixture.js';

const fixture = storageFixture();
describe('independent metadata review regressions', () => {
  it('rejects stale ingress without replacing a still-fresh capacity observation', async () => {
    const metadata = await fixture.open(undefined, { runtimeTtlMs: 60000 });
    expect((await metadata.getSettings({ kind: 'installation' })).version).toBe(1);
    await expect(metadata.updateRuntime(observation(settingsFixture().runtime, Date.now() - 60001)))
      .rejects.toMatchObject({ code: 'invalid_input' });
    expect((await metadata.getSettings({ kind: 'installation' })).version).toBe(1);
  });
  it('rejects an observation that ages in the queue without replacing fresh worker state', async () => {
    const base = Date.now(); const entry = join(fixture.root(), 'dequeue-clock.mjs');
    await writeFile(entry, `import {parentPort} from 'node:worker_threads';
      parentPort.on('message',command=>{if(command.kind==='runtime')Date.now=()=>${base + 59000}});
      await import(${JSON.stringify(fixture.workerUrl().href)});`);
    const metadata = await fixture.open(undefined, { runtimeTtlMs: 60000, workerUrl: pathToFileURL(entry) });
    expect((await metadata.getSettings({ kind: 'installation' })).version).toBe(1);
    await expect(metadata.updateRuntime(observation(settingsFixture().runtime, base - 2000, 60000)))
      .rejects.toMatchObject({ code: 'invalid_value' });
    expect((await metadata.getSettings({ kind: 'installation' })).version).toBe(1);
  });
  it('rejects original source expiry after queue delay even within the backend maximum age', async () => {
    const base = Date.now(); const entry = join(fixture.root(), 'dequeue-expiry.mjs');
    await writeFile(entry, `import {parentPort} from 'node:worker_threads';
      parentPort.on('message',command=>{if(command.kind==='runtime')Date.now=()=>${base + 2000}});
      await import(${JSON.stringify(fixture.workerUrl().href)});`);
    const metadata = await fixture.open(undefined, { runtimeTtlMs: 60000, workerUrl: pathToFileURL(entry) });
    await expect(metadata.updateRuntime(observation(settingsFixture().runtime, base, 1000)))
      .rejects.toMatchObject({ code: 'invalid_value' });
    expect((await metadata.getSettings({ kind: 'installation' })).version).toBe(1);
  });
  it('does not resurrect rollback-time updates without an intermediate read', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(10000);
    try {
      const runtime = new RuntimeCapacity({ installation: settingsFixture().chain.installation,
        runtime: observation(settingsFixture().runtime, 10000), runtimeTtlMs: 1000 });
      clock.mockReturnValue(10100); expect(runtime.snapshot()).not.toBeNull();
      clock.mockReturnValue(10050);
      expect(() => runtime.update(observation(settingsFixture().runtime, 10050))).toThrow();
      clock.mockReturnValue(10101); expect(runtime.snapshot()).toBeNull();
      expect(() => runtime.update(observation(settingsFixture().runtime, 10050))).toThrow();
      runtime.update(observation(settingsFixture().runtime, 10101)); expect(runtime.snapshot()).not.toBeNull();
    } finally { clock.mockRestore(); }
  });
  it('bounds actual indexed child enumeration before allocating a wide traversal frontier', async () => {
    const path = fixture.path(); const metadata = await fixture.open(path); await seed(metadata); await createFolder(metadata, 4);
    await fixture.close(metadata);
    const db = withRawGuards(new DatabaseSync(path, { enableForeignKeyConstraints: true })); registerSearchFold(db);
    let visits = 0;
    try {
      db.prepare(`WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<100000)
        INSERT INTO folders(id,organization_id,workspace_id,parent_id,version,name,folded_name)
        SELECT printf('00000000-0000-4000-8001-%012d',i),?,?,?,1,'child'||i,'child'||i FROM n`)
        .run(uuid(1), uuid(2), uuid(4));
      db.function('visit', (id: unknown) => { visits++; return String(id); });
      const prepare = db.prepare.bind(db);
      const queries: string[] = [];
      const instrument = vi.spyOn(db, 'prepare').mockImplementation(sql => {
        queries.push(sql);
        return prepare(sql.replace('SELECT f.id,s.depth+1', 'SELECT visit(f.id),s.depth+1')
          .replace('SELECT id FROM folders', 'SELECT id,visit(id) AS enumeration_probe FROM folders'));
      });
      try {
        expect(() => new Entities(db).subtreeHeight(scope, uuid(4))).toThrow();
        expect(visits).toBeLessThanOrEqual(10000);
        expect(visits).toBe(10000);
      } finally { instrument.mockRestore(); }
      const enumeration = queries.find(sql => sql.includes('AND parent_id=? ORDER BY id LIMIT ?'));
      expect(enumeration).toContain('INDEXED BY folders_children');
      const plan = prepare(`EXPLAIN QUERY PLAN ${enumeration}`).all(uuid(1), uuid(2), uuid(4), 10000);
      expect(plan.map(row => row.detail).join(' ')).toContain('folders_children');
      expect(plan.map(row => row.detail).join(' ')).not.toContain('TEMP B-TREE');
    } finally { db.close(); }
  });
  it('retains exact bounded subtree height and rejects corrupt depth/cycles', async () => {
    const path = fixture.path(); const metadata = await fixture.open(path); await seed(metadata);
    await createFolder(metadata, 4); await createFolder(metadata, 5, uuid(4)); await createFolder(metadata, 6, uuid(5));
    await createFolder(metadata, 7, uuid(4)); await fixture.close(metadata);
    const db = withRawGuards(new DatabaseSync(path, { enableForeignKeyConstraints: true })); registerSearchFold(db);
    try {
      const entities = new Entities(db);
      expect(entities.subtreeHeight(scope, uuid(4))).toBe(2);
      expect(entities.subtreeHeight(scope, uuid(6))).toBe(0);
      db.prepare('UPDATE folders SET parent_id=? WHERE id=?').run(uuid(6), uuid(4));
      expect(() => entities.subtreeHeight(scope, uuid(4))).toThrow();
      db.prepare('UPDATE folders SET parent_id=? WHERE id=?').run(uuid(3), uuid(4));
      const insert = db.prepare('INSERT INTO folders(id,organization_id,workspace_id,parent_id,version,name,folded_name) VALUES (?,?,?,?,1,?,?)');
      for (let id = 8; id <= 13; id++) insert.run(uuid(id), uuid(1), uuid(2), uuid(id === 8 ? 6 : id - 1), `deep${id}`, `deep${id}`);
      expect(() => entities.subtreeHeight(scope, uuid(4))).toThrow();
    } finally { db.close(); }
  });
  it('rejects workspace root pointer reassignment even when the proposed root passes foreign keys', async () => {
    const path = fixture.path(); const metadata = await fixture.open(path); await seed(metadata); await createFolder(metadata, 4);
    await fixture.close(metadata);
    const db = withRawGuards(new DatabaseSync(path, { enableForeignKeyConstraints: true })); registerSearchFold(db);
    try {
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(() => db.prepare('UPDATE workspaces SET root_folder_id=? WHERE id=?').run(uuid(4), uuid(2))).toThrow();
      expect(db.prepare('SELECT root_folder_id FROM workspaces WHERE id=?').get(uuid(2))?.root_folder_id).toBe(uuid(3));
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally { db.close(); }
  });
});
