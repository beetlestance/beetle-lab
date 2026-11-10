import { expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { initialize } from '../../../src/journal/schema.js';
import { migration014 } from '../../../src/journal/migration014.js';
import { transaction } from '../../../src/journal/sql.js';
import { absenceFixture } from './fixtures.js';
import { removeFutureAbsence } from '../legacy-fixtures.js';

const f = absenceFixture();

/** Downgrade only additive14 objects; historical migrations are exercised unchanged. */
export function schema13(db: DatabaseSync): void {
  transaction(db, () => {
    removeFutureAbsence(db);
  });
}

it.each([false, true])('backfills only bounded debt from exact schema13 fresh=%s, preserving original bytes and FKs', async fresh => {
  const e = await f.ready(fresh); schema13(e.db);
  const before = e.db.prepare('SELECT * FROM accepted_attempts').all();
  const sequence = e.db.prepare('SELECT * FROM sqlite_sequence ORDER BY name').all();
  f.closeNative(e.db); const db = initialize(e.path);
  try {
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(14);
    expect(db.prepare('SELECT * FROM accepted_attempts').all()).toEqual(before.map(row => ({ ...row, absence_bytes: 0, absence_pending: 1 })));
    expect(db.prepare('SELECT * FROM sqlite_sequence ORDER BY name').all()).toEqual(sequence);
    expect(db.prepare('SELECT * FROM output_absence_closures').all()).toEqual([]);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); }
});

it.each(['collision', 'commit'] as const)('rolls back all migration14 DDL/debt/originals on %s failure', async kind => {
  const e = await f.ready(); schema13(e.db);
  if (kind === 'collision') e.db.exec('CREATE TABLE output_absence_closures(canary TEXT)');
  else e.db.exec(`CREATE TABLE fault_parent(id PRIMARY KEY); CREATE TABLE fault_child(id REFERENCES fault_parent(id) DEFERRABLE INITIALLY DEFERRED);
    CREATE TRIGGER migration_fault AFTER UPDATE ON accepted_attempts BEGIN INSERT INTO fault_child VALUES(1); END;`);
  const graph = e.db.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY name').all();
  const before = e.db.prepare('SELECT * FROM accepted_attempts').all();
  expect(() => transaction(e.db, () => migration014(e.db))).toThrow();
  expect(e.db.prepare('PRAGMA user_version').get()?.user_version).toBe(13);
  expect(e.db.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY name').all()).toEqual(graph);
  expect(e.db.prepare('SELECT * FROM accepted_attempts').all()).toEqual(before);
});

it('preflights at4097 before DDL without loading historical payloads', async () => {
  const e = await f.ready(true); schema13(e.db);
  // Real bounded SQLite rows; the extra originals carry no admission or native authority.
  e.db.exec(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<4096)
    INSERT INTO accepted_attempts(attempt_id,organization_id,workspace_id,intent_digest,generation,state,last_seq,offer_json,canonical_json)
    SELECT printf('10000000-0000-4000-8000-%012d',x),a.organization_id,a.workspace_id,a.intent_digest,1,'offered',0,a.offer_json,a.canonical_json
    FROM n CROSS JOIN accepted_attempts a WHERE a.id=1;`);
  const graph = e.db.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY name').all();
  expect(() => transaction(e.db, () => migration014(e.db))).toThrow(expect.objectContaining({ code: 'unavailable' }));
  expect(e.db.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY name').all()).toEqual(graph);
  expect(e.db.prepare('PRAGMA user_version').get()?.user_version).toBe(13);
  e.db.exec('DELETE FROM accepted_attempts WHERE id=(SELECT MAX(id) FROM accepted_attempts)');
  transaction(e.db, () => migration014(e.db));
  expect(e.db.prepare('PRAGMA user_version').get()?.user_version).toBe(14);
  expect(e.db.prepare('SELECT COUNT(*) AS n FROM accepted_attempts').get()?.n).toBe(4096);
  expect(e.db.prepare('SELECT COUNT(*) AS n FROM output_absence_closures').get()?.n).toBe(0);
});

it('rejects physically mismatched retained proof on read/reopen instead of synthesizing a replacement', async () => {
  const e = await f.ready(true);
  e.store.execute({ id: 1, kind: 'outputAbsenceClose', key: e.key });
  e.db.exec(`DROP TRIGGER absence_update;
    UPDATE output_absence_closures SET proof_json=json_set(proof_json,'$.journalAuthority','00000000-0000-4000-8000-000000000099');`);
  expect(() => e.store.execute({ id: 2, kind: 'outputAbsenceRead', key: e.key })).toThrow('unavailable');
  f.closeNative(e.db); const journal = await f.open(e.path);
  await expect(journal.readOutputAbsence(e.key)).rejects.toMatchObject({ code: 'unavailable' });
});
