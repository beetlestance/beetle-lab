import { expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { inputRecord, inputColumns, inputSource } from '../../src/adapters/outbound/sqlite/input-row.js';
import { scope, seed, storageFixture, uuid } from './fixture.js';
import { createInput, inputOptions } from './inputs-fixture.js';
import { rawConnection } from './raw-connection-fixture.js';
const f = storageFixture();
const valid = {
  id: uuid(90),
  organization_id: scope.organizationId,
  workspace_id: scope.workspaceId,
  folder_id: uuid(3),
  name: 'Input',
  sha256: 'a'.repeat(64),
  bytes: 12,
  offset: 0,
  version: 1,
  state: 'staging',
  reason: null,
};
it.each([
  { id: 'invalid' },
  { folder_id: 'invalid' },
  { sha256: 'x'.repeat(64) },
  { state: 'unknown' },
  { reason: 'unknown' },
  { bytes: 8388609 },
  { offset: 13 },
  { version: 1.5 },
  { version: 9007199254740992 },
  { state: 'published', offset: 11 },
  { state: 'publishing', offset: 11 },
])('refuses malformed stored input fields: %j', (amendment) => {
  expect(() => inputRecord({ ...valid, ...amendment }, scope)).toThrow();
});
it('validates scope and preserves valid legacy failure and zero-length published states', () => {
  expect(() => inputRecord({ ...valid, workspace_id: uuid(9) }, scope)).toThrow();
  expect(inputRecord({ ...valid, state: 'failed', reason: 'unverified_legacy' }, scope).reason).toBe(
    'unverified_legacy',
  );
  expect(inputRecord({ ...valid, bytes: 0, offset: 0, state: 'published' }, scope).bytes).toBe(0);
});
it('bounds input text and refuses a corrupt nullable reason without materializing its payload', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(
      `CREATE TABLE input_blobs(id,organization_id,workspace_id,folder_id,name,sha256,bytes,offset,version,state,reason,
      created_at,published_at); CREATE TABLE input_shapes(organization_id,workspace_id,input_id,row_count,column_count);
      CREATE TABLE input_usage_counts(organization_id,workspace_id,input_id,revisions);`,
    );
    db.prepare('INSERT INTO input_blobs VALUES(?,?,?,?,?,?,?,?,?,?,?,NULL,NULL)').run(
      valid.id,
      valid.organization_id,
      valid.workspace_id,
      valid.folder_id,
      'X'.repeat(1000000),
      valid.sha256,
      12,
      0,
      1,
      'staging',
      Buffer.from('io'),
    );
    const row = db.prepare(`SELECT ${inputColumns} FROM ${inputSource()}`).get();
    expect(row?.name).toBeNull();
    expect(row?.reason).toBe('');
    expect(() => inputRecord(row, scope)).toThrow();
  } finally {
    db.close();
  }
});
it.each(['get', 'list', 'recovery'])('rejects a corrupt stored input through real worker %s', async (operation) => {
  const path = f.path();
  const initial = await f.open(path, inputOptions());
  await seed(initial);
  await initial.inputs.control(createInput());
  await f.close(initial);
  corruptStoredInput(path, uuid(90));
  const metadata = await f.open(path, inputOptions());
  const result =
    operation === 'get'
      ? metadata.inputs.get({ scope, id: uuid(90) })
      : operation === 'list'
        ? metadata.inputs.list({ scope, limit: 100 })
        : metadata.inputs.recovery({ limit: 100 });
  await expect(result).rejects.toMatchObject({ code: 'unavailable', message: 'Storage unavailable' });
});

function corruptStoredInput(path: string, id: string): void {
  const db = rawConnection(path);
  try {
    // This task-owned fixture simulates stored corruption, not an allowed writer.
    const guard = db
      .prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='inputs_identity'")
      .get()?.sql;
    if (typeof guard !== 'string') throw Error('Missing real immutable input guard');
    db.exec('DROP TRIGGER inputs_identity');
    db.prepare('UPDATE input_blobs SET name=? WHERE id=?').run('PRIVATE-CANARY\u0000', id);
    db.exec(guard);
  } finally {
    db.close();
  }
}

it('refuses a corrupt recovery overflow row before creating a cursor', async () => {
  const path = f.path();
  const original = await f.open(path, inputOptions());
  await seed(original);
  await original.inputs.control(createInput(90));
  await original.inputs.control(createInput(91));
  await f.close(original);
  corruptStoredInput(path, uuid(91));
  const metadata = await f.open(path, inputOptions());
  await expect(metadata.inputs.recovery({ limit: 1 })).rejects.toMatchObject({ code: 'unavailable' });
});
