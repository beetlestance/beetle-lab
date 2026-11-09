import { expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { legacyDatabase } from './inputs-migration-fixture.js';
import { storageFixture, scope, uuid } from './fixture.js';
import { createInput, transition } from './inputs-fixture.js';
import { append, request } from './suites-fixture.js';

const fixture = storageFixture();
it('migrates v2 with bounded historical pins, preserves immutable bytes/receipts/settings, and fences legacy custody after reopening', async () => {
  const path = fixture.path(); const legacy = legacyDatabase(path, 205);
  const settings = legacy.db.prepare('SELECT * FROM settings ORDER BY scope_key').all();
  const receipts = legacy.db.prepare('SELECT * FROM receipts ORDER BY scope_key,request_id').all(); legacy.db.close();
  let metadata = await fixture.open(path);
  expect(await metadata.inputs.storage()).toEqual({ chargedBytes: 2 * 65536 + 19, allocationBytes: 10000, freeSpaceReserveBytes: 1000 });
  await expect(metadata.inputs.control(createInput(92, 0))).rejects.toMatchObject({ code: 'capacity_unavailable' });
  const oldPublished = await metadata.inputs.get({ scope, id: uuid(90) });
  expect(oldPublished).toMatchObject({ state: 'publishing', version: 1, offset: 12, name: `input-${uuid(90)}`, folderId: uuid(3), reason: null });
  const oldStaging = await metadata.inputs.get({ scope, id: uuid(91) });
  expect(oldStaging).toMatchObject({ state: 'failed', version: 1, offset: 0, reason: 'unverified_legacy' });
  await expect(metadata.inputs.advance({ kind: 'commitInputOffset', key: { scope, id: uuid(91) }, expectedVersion: 1, offset: 7 }))
    .rejects.toMatchObject({ code: 'conflict' });
  const suite = await metadata.suites.getSuite({ scope, id: uuid(50) }); const body = request(2);
  body.config.datasets = [{ id: 'data', kind: 'json', selection: 'byVu', input: legacy.pin }];
  await expect(append(metadata, suite, 2000, body)).rejects.toMatchObject({ code: 'not_found' });
  await expect(metadata.inputs.control(transition(oldPublished, 'deleteInput'))).rejects.toMatchObject({ code: 'conflict' });
  expect(await metadata.namespaces.execute({ ...legacy.original, id: uuid(99) })).toEqual(legacy.organization);
  await fixture.close(metadata);
  const db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(3);
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  expect(db.prepare('SELECT count(*) AS n FROM revision_input_pins').get()?.n).toBe(205);
  expect(db.prepare('SELECT config_json,input_manifest_json,digest FROM suite_revisions WHERE id=?').get(uuid(1001)))
    .toEqual({ config_json: legacy.config, input_manifest_json: legacy.manifest, digest: 'c'.repeat(64) });
  expect(db.prepare('SELECT * FROM settings ORDER BY scope_key').all()).toEqual(settings);
  expect(db.prepare('SELECT * FROM receipts ORDER BY scope_key,request_id').all()).toEqual(receipts); db.close();
  metadata = await fixture.open(path, { runtime: null });
  expect(await metadata.inputs.get({ scope, id: uuid(90) })).toEqual(oldPublished);
  expect((await metadata.inputs.storage()).chargedBytes).toBe(2 * 65536 + 19);
  // Trusted future byte-service verification fixture; it does not establish filesystem custody.
  await metadata.inputs.advance({ kind: 'publishInput', key: { scope, id: uuid(90) }, expectedVersion: 1 });
  expect((await append(metadata, suite, 2000, body)).inputManifest).toEqual([legacy.pin]);
  const accepted = await metadata.inputs.control(transition(oldStaging, 'deleteInput'));
  expect(accepted).toMatchObject({ acceptedVersion: 2 });
  await metadata.inputs.advance({ kind: 'deleteInputBytes', key: { scope, id: uuid(91) }, expectedVersion: 2 });
  expect((await metadata.inputs.storage()).chargedBytes).toBe(2 * 65536 + 12);
});
it('rolls back migration003 atomically when a retained manifest has inconsistent identity', async () => {
  const path = fixture.path(); const legacy = legacyDatabase(path);
  // Simulate a corrupt v2 database while preserving its old immutable revision bytes.
  legacy.db.exec('DROP TRIGGER revisions_no_update');
  legacy.db.prepare('UPDATE suite_revisions SET input_manifest_json=?').run(JSON.stringify([{ ...legacy.pin, bytes: 13 }]));
  const before = legacy.db.prepare('SELECT * FROM input_blobs ORDER BY id').all();
  const revision = legacy.db.prepare('SELECT * FROM suite_revisions').get(); legacy.db.close();
  await expect(fixture.open(path)).rejects.toMatchObject({ code: 'unavailable' });
  const check = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  expect(check.prepare('PRAGMA user_version').get()?.user_version).toBe(2);
  expect(check.prepare('SELECT * FROM input_blobs ORDER BY id').all()).toEqual(before);
  expect(check.prepare('SELECT * FROM suite_revisions').get()).toEqual(revision);
  for (const table of ['input_blobs_v2', 'installation_storage_usage', 'revision_input_pins']) {
    expect(check.prepare('SELECT name FROM sqlite_master WHERE name=?').get(table)).toBeUndefined();
  }
  expect(check.prepare('PRAGMA foreign_key_check').all()).toEqual([]); check.close();
});
it('rolls back unsafe legacy input constraints and preserves legacy payloads instead of fabricating metadata', async () => {
  const path = fixture.path(); const legacy = legacyDatabase(path);
  // v2 allowed a 64-character non-hex hash; the stronger contract must fail closed.
  legacy.db.prepare('UPDATE input_blobs SET sha256=? WHERE id=?').run('z'.repeat(64), uuid(91)); legacy.db.close();
  await expect(fixture.open(path)).rejects.toMatchObject({ code: 'conflict' });
  const db = new DatabaseSync(path);
  expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(2);
  expect(db.prepare('SELECT sha256 FROM input_blobs WHERE id=?').get(uuid(91))?.sha256).toBe('z'.repeat(64)); db.close();
});
it('refuses orphan legacy rows without silently dropping their charged custody', async () => {
  const path = fixture.path(); const legacy = legacyDatabase(path);
  legacy.db.exec('PRAGMA foreign_keys=OFF');
  legacy.db.prepare('UPDATE input_blobs SET workspace_id=? WHERE id=?').run(uuid(999), uuid(91));
  const before = legacy.db.prepare('SELECT * FROM input_blobs ORDER BY id').all(); legacy.db.close();
  await expect(fixture.open(path)).rejects.toMatchObject({ code: 'conflict' });
  const db = new DatabaseSync(path);
  expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(2);
  expect(db.prepare('SELECT * FROM input_blobs ORDER BY id').all()).toEqual(before); db.close();
});
