import { beforeAll, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import type { Run } from '@beetle/contracts/api';
import { captureRunRow, runColumns } from '../../src/adapters/outbound/sqlite/run-row.js';
import { scope, seed, storageFixture, uuid } from './fixture.js';
import { append, createSuite } from './suites-fixture.js';
import { runCommand, runOptions } from './runs-fixture.js';
const f = storageFixture();
let run: Run;
beforeAll(async () => {
  const metadata = await f.open(undefined, runOptions());
  await seed(metadata);
  const revision = await append(metadata, await createSuite(metadata));
  run = await metadata.runs.execute(runCommand(revision.id));
  await f.close(metadata);
});
function row() {
  return {
    snapshot_json: JSON.stringify(run),
    version: run.version,
    state: run.state,
    outcome: run.outcome,
    validation_status: run.validationStatus,
    active_attempt_id: run.activeAttemptId,
    cancellation_requested: 0,
    reason: null,
  };
}
it('captures a valid persisted run without changing it', () => {
  expect(captureRunRow(row(), { scope, id: run.id })).toEqual(run);
});
it.each([
  { snapshot_json: 'invalid' },
  { snapshot_json: 'null' },
  { snapshot_json: '[]' },
  { snapshot_json: Buffer.from('{}') },
  { version: 1.5 },
  { version: 9007199254740992 },
  { state: 'unknown' },
  { outcome: 'unknown' },
  { validation_status: 'unknown' },
  { active_attempt_id: 'invalid' },
  { cancellation_requested: 2 },
  { cancellation_requested: '0' },
  { reason: 'unknown' },
])('refuses malformed persisted run field %j', (amendment) => {
  expect(() => captureRunRow({ ...row(), ...amendment }, { scope, id: run.id })).toThrow();
});
it('rejects corrupt snapshot fields even when the mutable overlay would hide them', () => {
  expect(() =>
    captureRunRow({ ...row(), snapshot_json: JSON.stringify({ ...run, version: 'invalid' }) }, { scope, id: run.id }),
  ).toThrow();
});
it('refuses snapshot owner and identity mismatches', () => {
  expect(() => captureRunRow(row(), { scope, id: uuid(999) })).toThrow();
  expect(() => captureRunRow(row(), { scope: { ...scope, workspaceId: uuid(999) }, id: run.id })).toThrow();
});
it('bounds JSON and nullable diagnostic text in SQL before parsing', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(
      'CREATE TABLE runs(snapshot_json,state,outcome,validation_status,active_attempt_id,reason,version,cancellation_requested)',
    );
    db.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)').run(
      'X'.repeat(1000000),
      'queued',
      'pending',
      'pending',
      run.activeAttemptId,
      Buffer.from('io'),
      1,
      0,
    );
    const projected = db.prepare(`SELECT ${runColumns} FROM runs`).get();
    expect(projected?.snapshot_json).toBeNull();
    expect(projected?.reason).toBe('');
    expect(() => captureRunRow(projected, { scope, id: run.id })).toThrow();
  } finally {
    db.close();
  }
});
