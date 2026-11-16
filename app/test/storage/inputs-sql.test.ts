import {withRawGuards} from './raw-connection-fixture.js';
import { expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import type { InputRecord } from '../../src/ports/inputs.js';
import { createInput, inputOptions, trustedPublish, transition } from './inputs-fixture.js';
import { storageFixture, scope, seed, uuid } from './fixture.js';
import { createSuite, append, request } from './suites-fixture.js';
const fixture = storageFixture();

it('enforces immutable lifecycle, safe progress, scoped identity, and no REPLACE resurrection with recursive triggers off', async () => {
  const path = fixture.path(); const metadata = await fixture.open(path, inputOptions()); await seed(metadata); await seed(metadata, 11, 12, 13);
  const input = await metadata.inputs.control(createInput()) as InputRecord; await fixture.close(metadata);
  const db = withRawGuards(new DatabaseSync(path, { enableForeignKeyConstraints: true })); db.exec('PRAGMA recursive_triggers=OFF');
  const before = db.prepare('SELECT * FROM input_blobs').get();
  const attacks = [
    "offset=13,version=2", "offset=-1,version=2", "offset=0.5,version=2", "offset=12,version=1",
    "offset=12,version=9007199254740992", "state='published',offset=12,version=2",
    "state='publishing',offset=12,version=2", "state='deleted',version=2",
    "state='failed',reason=NULL,version=2", "state='failed',reason='private',version=2",
    "sha256='b'||substr(sha256,2),version=2", "bytes=13,version=2", "folder_id='missing',version=2",
    "id='changed',version=2", "organization_id='other',version=2", "workspace_id='other',version=2",
    "name='changed',version=2", "create_request_id='changed',version=2", "seal_request_id='changed',offset=1,version=2",
    "delete_request_id='changed',offset=1,version=2",
  ];
  for (const set of attacks) expect(() => db.exec(`UPDATE input_blobs SET ${set}`)).toThrow();
  expect(() => db.exec('DELETE FROM input_blobs')).toThrow();
  expect(() => db.exec('INSERT OR REPLACE INTO input_blobs SELECT * FROM input_blobs')).toThrow();
  const columns = 'id,organization_id,workspace_id,folder_id,name,sha256,bytes,offset,version,state,create_request_id';
  const insert = db.prepare(`INSERT INTO input_blobs(${columns}) VALUES(?,?,?,?,?,?,?,0,1,'staging',?)`);
  const args = [uuid(91), scope.organizationId, scope.workspaceId, uuid(3), 'New', 'a'.repeat(64), 12, uuid(99)] as const;
  expect(() => insert.run(uuid(91), uuid(11), scope.workspaceId, uuid(3), 'New', 'a'.repeat(64), 12, uuid(99))).toThrow();
  expect(() => insert.run(uuid(91), scope.organizationId, scope.workspaceId, uuid(13), 'New', 'a'.repeat(64), 12, uuid(99))).toThrow();
  for (const hash of ['A'.repeat(64), 'z'.repeat(64), 'a'.repeat(63)]) expect(() => insert.run(...args.slice(0, 5), hash, 12, uuid(99))).toThrow();
  for (const bytes of [-1, 0.1, 8388609]) expect(() => insert.run(...args.slice(0, 6), bytes, uuid(99))).toThrow();
  expect(db.prepare('SELECT * FROM input_blobs').get()).toEqual(before);
  expect(db.prepare('SELECT charged_bytes FROM installation_storage_usage').get()?.charged_bytes).toBe(65548);
  expect(() => db.exec('INSERT OR REPLACE INTO installation_storage_usage VALUES(1,0)')).toThrow();
  expect(() => db.exec('DELETE FROM installation_storage_usage')).toThrow();
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]); db.close();
  const reopened = await fixture.open(path, { ...inputOptions(), runtime: null });
  expect(await reopened.inputs.get({ scope, id: input.id })).toEqual(input);
});
it('enforces retained exact scoped pins independently and serializes direct deletion attacks', async () => {
  const path = fixture.path(); const metadata = await fixture.open(path, inputOptions()); await seed(metadata); await seed(metadata, 11, 12, 13);
  const input = await trustedPublish(metadata, await metadata.inputs.control(createInput()) as InputRecord);
  const staged = await metadata.inputs.control(createInput(91)) as InputRecord;
  const suite = await createSuite(metadata); const body = request();
  body.config.datasets = [{ id: 'data', kind: 'json', selection: 'byVu', input: { id: input.id, sha256: input.sha256, bytes: input.bytes } }];
  const revision = await append(metadata, suite, 60, body); await fixture.close(metadata);
  const db = withRawGuards(new DatabaseSync(path, { enableForeignKeyConstraints: true })); db.exec('PRAGMA recursive_triggers=OFF');
  const count = () => db.prepare('SELECT count(*) AS n FROM revision_input_pins').get()?.n;
  expect(count()).toBe(1);
  expect(() => db.exec('INSERT OR REPLACE INTO revision_input_pins SELECT * FROM revision_input_pins')).toThrow();
  expect(() => db.exec('DELETE FROM revision_input_pins')).toThrow();
  expect(() => db.exec('UPDATE revision_input_pins SET bytes=13')).toThrow();
  const insert = db.prepare('INSERT INTO revision_input_pins VALUES(?,?,?,?,?,?)');
  expect(() => insert.run(revision.id, scope.organizationId, scope.workspaceId, staged.id, staged.sha256, staged.bytes)).toThrow();
  expect(() => insert.run(uuid(999), scope.organizationId, scope.workspaceId, input.id, input.sha256, input.bytes)).toThrow();
  expect(() => insert.run(revision.id, uuid(11), uuid(12), input.id, input.sha256, input.bytes)).toThrow();
  expect(() => db.prepare("UPDATE input_blobs SET state='deleting',version=version+1,delete_request_id=? WHERE id=?")
    .run(uuid(99), input.id)).toThrow();
  expect(count()).toBe(1); expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]); db.close();
  const reopened = await fixture.open(path, { ...inputOptions(), runtime: null });
  await expect(reopened.inputs.control(transition(input, 'deleteInput'))).rejects.toMatchObject({ code: 'conflict' });
});
it('rolls back lifecycle/payload charges when shared receipt persistence fails', async () => {
  const path = fixture.path(); let metadata = await fixture.open(path, inputOptions()); await seed(metadata); await fixture.close(metadata);
  const db = new DatabaseSync(path); db.exec("CREATE TRIGGER fail_receipt BEFORE INSERT ON receipts BEGIN SELECT RAISE(ABORT,'fault'); END"); db.close();
  metadata = await fixture.open(path, { ...inputOptions(), runtime: null }); const create = createInput();
  await expect(metadata.inputs.control(create)).rejects.toMatchObject({ code: 'conflict' });
  expect((await metadata.inputs.storage()).chargedBytes).toBe(0);
  await expect(metadata.inputs.get({ scope, id: create.id })).rejects.toMatchObject({ code: 'not_found' }); await fixture.close(metadata);
  const repair = new DatabaseSync(path); repair.exec('DROP TRIGGER fail_receipt'); repair.close();
  metadata = await fixture.open(path, { ...inputOptions(), runtime: null });
  const input = await metadata.inputs.control(create) as InputRecord; await fixture.close(metadata);
  const fault = new DatabaseSync(path); fault.exec("CREATE TRIGGER fail_receipt BEFORE INSERT ON receipts BEGIN SELECT RAISE(ABORT,'fault'); END"); fault.close();
  metadata = await fixture.open(path, { ...inputOptions(), runtime: null });
  await expect(metadata.inputs.control(transition(input, 'deleteInput'))).rejects.toMatchObject({ code: 'conflict' });
  expect(await metadata.inputs.get({ scope, id: input.id })).toEqual(input);
  expect((await metadata.inputs.storage()).chargedBytes).toBe(65548);
});
