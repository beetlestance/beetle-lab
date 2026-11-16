import {withRawGuards} from './raw-connection-fixture.js';
import { registerSearchFold } from '../../src/adapters/outbound/sqlite/run-search-fold.js';
import { expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { encodeJson } from '@beetle/contracts';
import { validateApi } from '@beetle/contracts/api';
import { transaction } from '../../src/adapters/outbound/sqlite/schema.js';
import { command, requestId, scope, seed, settingsCommand, storageFixture, uuid } from './fixture.js';
import { append, createSuite, suiteCommand } from './suites-fixture.js';
const fixture = storageFixture();
it('rejects SQL replacement by existing revision identity or suite ordinal with recursive triggers disabled', async () => {
  const path = fixture.path(); const metadata = await fixture.open(path); await seed(metadata);
  const suite = await createSuite(metadata); const revision = await append(metadata, suite); await fixture.close(metadata);
  const db = withRawGuards(new DatabaseSync(path, { enableForeignKeyConstraints: true })); registerSearchFold(db);
  try {
    db.exec('PRAGMA recursive_triggers=OFF');
    const replace = db.prepare(`INSERT OR REPLACE INTO suite_revisions
      SELECT ?,suite_id,organization_id,workspace_id,ordinal,?,config_json,input_manifest_json FROM suite_revisions WHERE id=?`);
    for (const id of [revision.id, uuid(99)]) expect(() => replace.run(id, 'b'.repeat(64), revision.id)).toThrow();
    expect(db.prepare('SELECT digest FROM suite_revisions WHERE id=?').get(revision.id)?.digest).toBe(revision.digest);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); }
});

it('preserves the existing 1MiB reply budget for 100 Unicode suites and namespace folders', async () => {
  const path = fixture.path(); let metadata = await fixture.open(path); await seed(metadata); await fixture.close(metadata);
  // This regression concerns reply transport. Seed valid page rows in one transaction,
  // rather than adding 200 fsync-heavy mutation receipts to unrelated lifecycle tests.
  const db = withRawGuards(new DatabaseSync(path, { enableForeignKeyConstraints: true })); registerSearchFold(db);
  try {
    transaction(db, () => {
      for (let index = 0; index < 100; index++) {
        const name = '🪲'.repeat(125) + String(index).padStart(3, '0');
        expect(validateApi('CreateSuiteRequest', { scope, requestId: requestId(), name }).ok).toBe(true);
        const fold = name.normalize('NFKC').toLowerCase();
        db.prepare('INSERT INTO suites VALUES (?,?,?,?,?,?,1,NULL)').run(uuid(1000 + index), scope.organizationId, scope.workspaceId, uuid(3), name, fold);
        db.prepare('INSERT INTO folders VALUES (?,?,?,?,1,?,?)').run(uuid(2000 + index), scope.organizationId, scope.workspaceId, uuid(3), name, fold);
      }
    });
  } finally { db.close(); }
  metadata = await fixture.open(path);
  const suites = await metadata.suites.listSuites({ scope, limit: 100 });
  const folders = await metadata.list({ kind: 'folder', scope, parentFolderId: uuid(3), limit: 100 });
  expect(suites.items).toHaveLength(100); expect(folders.items).toHaveLength(100);
  expect(validateApi('SuitePage', suites).ok).toBe(true);
  expect(validateApi('FolderPage', { scope, ...folders }).ok).toBe(true);
  for (const page of [suites, folders]) expect(Buffer.byteLength(encodeJson(page, 1048576))).toBeGreaterThan(65536);
});
it('binds page cursors to scope, suite and limit and rejects malformed continuations', async () => {
  const metadata = await fixture.open(); await seed(metadata); await seed(metadata, 11, 12, 13);
  const suite = await createSuite(metadata); const other = await createSuite(metadata, 51);
  await append(metadata, suite); await append(metadata, { ...suite, version: 2 }, 61);
  const revisionPage = await metadata.suites.listRevisions({ scope, suiteId: suite.id, limit: 1 });
  await expect(metadata.suites.listRevisions({ scope, suiteId: other.id, limit: 1, cursor: revisionPage.nextCursor! }))
    .rejects.toMatchObject({ code: 'invalid_input' });
  const page = await metadata.suites.listSuites({ scope, limit: 1 });
  const foreign = { ...scope, organizationId: uuid(11), workspaceId: uuid(12) };
  await expect(metadata.suites.listSuites({ scope: foreign, limit: 1, cursor: page.nextCursor! }))
    .rejects.toMatchObject({ code: 'invalid_input' });
  await expect(metadata.suites.listSuites({ scope, limit: 1, cursor: 'not-json' })).rejects.toMatchObject({ code: 'invalid_input' });
  expect((await metadata.suites.listSuites({ scope, limit: 1, cursor: page.nextCursor! })).items).toEqual([other]);
});
it('enforces exact composite revision/folder ownership in SQL', async () => {
  const path = fixture.path(); const metadata = await fixture.open(path); await seed(metadata); await seed(metadata, 11, 12, 13);
  const suite = await createSuite(metadata); const other = await createSuite(metadata, 51);
  const revision = await append(metadata, suite); await fixture.close(metadata);
  const db = withRawGuards(new DatabaseSync(path, { enableForeignKeyConstraints: true })); registerSearchFold(db);
  try {
    expect(() => db.prepare('UPDATE suites SET current_revision_id=? WHERE id=?').run(revision.id, other.id)).toThrow();
    expect(() => db.prepare('UPDATE suites SET folder_id=? WHERE id=?').run(uuid(13), suite.id)).toThrow();
    expect(() => db.prepare('UPDATE suites SET workspace_id=? WHERE id=?').run(uuid(12), suite.id)).toThrow();
  } finally { db.close(); }
});
it('preserves namespace/settings receipt replay and rejects cross-kind reuse without runtime capacity', async () => {
  const metadata = await fixture.open(); await seed(metadata);
  const id = requestId();
  const folder = command({ kind: 'createFolder', id: uuid(90), request: { scope, requestId: id, parentFolderId: uuid(3), name: 'Folder' } });
  const original = await metadata.namespaces.execute(folder);
  const identity = await metadata.getSettingsIdentity(scope);
  const settings = settingsCommand(identity.id, { scope, requestId: requestId(), expectedVersion: 1, schemaVersion: 2, patch: { runDefaults: { budget: { cpuMillis: 100 } } } });
  const changed = await metadata.settings.execute(settings);
  await metadata.updateRuntime(null);
  expect(await metadata.namespaces.execute({ ...folder, id: uuid(91) })).toEqual(original);
  expect(await metadata.settings.execute(settings)).toEqual(changed);
  await expect(metadata.suites.execute(suiteCommand({ kind: 'createSuite', id: uuid(50), request: { scope, requestId: id, name: 'Collision' } })))
    .rejects.toMatchObject({ code: 'conflict' });
  expect((await createSuite(metadata)).version).toBe(1);
});
it('keeps other metadata command envelopes at 64KiB while reserving close capacity', async () => {
  const metadata = await fixture.open(); await seed(metadata);
  const base = suiteCommand({ kind: 'createSuite', id: uuid(50), request: { scope, requestId: requestId(), name: 'Suite' } });
  const oversized = { ...base, padding: 'x'.repeat(65536) };
  await expect(metadata.suites.execute(oversized)).rejects.toMatchObject({ code: 'invalid_input' });
  expect((await metadata.suites.listSuites({ scope, limit: 100 })).items).toEqual([]);
});
it('permits identical intent replay after cancellation with unknown commit outcome', async () => {
  const path = fixture.path(); let metadata = await fixture.open(path); await seed(metadata);
  const original = suiteCommand({ kind: 'createSuite', id: uuid(50), request: { scope, requestId: requestId(), name: 'Unknown' } });
  const pending = metadata.suites.execute(original).then(value => ({ value }), error => ({ error: error as unknown }));
  await metadata.abort(); fixture.handles.delete(metadata); await pending;
  metadata = await fixture.open(path);
  const value = await metadata.suites.execute({ ...original, id: uuid(51) });
  expect(await metadata.suites.execute({ ...original, id: uuid(52) })).toEqual(value);
  expect((await metadata.suites.listSuites({ scope, limit: 100 })).items).toEqual([value]);
});

it('normalizes suite identities and uses actual workspace root with case-insensitive lookup', async () => {
  const metadata = await fixture.open(); await seed(metadata);
  const uppercase = 'ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF';
  const value = await metadata.suites.execute(suiteCommand({ kind: 'createSuite', id: uppercase,
    request: { scope, requestId: requestId(), name: 'Case' } }));
  expect(value.id).toBe(uppercase.toLowerCase());
  expect(await metadata.suites.getSuite({ scope, id: uppercase })).toEqual(value);
});
