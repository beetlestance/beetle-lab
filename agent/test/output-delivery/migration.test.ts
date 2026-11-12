import { CURRENT_JOURNAL_SCHEMA } from '../journal/legacy-fixtures.js';
import { DatabaseSync } from 'node:sqlite';
import { expect, it, vi } from 'vitest';
import { initialize } from '../../src/journal/schema.js';
import { migration013 } from '../../src/journal/migration013.js';
import { transaction } from '../../src/journal/sql.js';
import type { OutputDeliveryClosure } from '../../src/journal/output-delivery-protocol.js';
import { deliveryFixture, durableRows, insertClosure, inspect, json, schema12 } from './fixtures.js';
const f = deliveryFixture();

it('initializes current schema with empty delivery charge and no manufactured source/closure', () => {
  const db = initialize(f.path());
  try {
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(CURRENT_JOURNAL_SCHEMA);
    expect(db.prepare('SELECT * FROM output_delivery_closures').all()).toEqual([]);
    expect(db.prepare('SELECT * FROM output_sources').all()).toEqual([]);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); }
});
it('upgrades an actual schema12 released source with only debt marker and preserves all originals, sequences and FKs', async () => {
  const e = await f.nativeReady(); schema12(e.db);
  const before = e.db.prepare('SELECT * FROM accepted_attempts').get();
  const source = e.db.prepare('SELECT * FROM output_sources').all(); const reservation = e.db.prepare('SELECT * FROM reservations').all();
  const sequence = e.db.prepare('SELECT * FROM sqlite_sequence ORDER BY name').all();
  expect(e.db.prepare('PRAGMA user_version').get()?.user_version).toBe(12); f.closeNative(e.db);
  const journal = await f.open(e.path); expect(await journal.readOutputDelivery(e.key)).toBeNull();
  expect(await journal.scanRunnable({ lane: 'delivery', limit: 32 })).toEqual({ attempts: [e.key], through: 1 });
  await f.close(journal); const db = new DatabaseSync(e.path);
  try {
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(CURRENT_JOURNAL_SCHEMA);
    expect(db.prepare('SELECT * FROM accepted_attempts').get()).toEqual({ ...before, delivery_bytes: 0, delivery_pending: 1,
      absence_bytes: 0, absence_pending: 0, execution_purpose: 'performance', export_result_json: null });
    expect(db.prepare('SELECT * FROM output_sources').all()).toEqual(source);
    expect(db.prepare('SELECT * FROM reservations').all()).toEqual(reservation);
    expect(db.prepare('SELECT * FROM sqlite_sequence ORDER BY name').all()).toEqual(sequence);
    expect(db.prepare('SELECT * FROM output_delivery_closures').all()).toEqual([]);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); }
});
it('does not invent source or closure for a genuine old released original without collection intent', async () => {
  const e = await f.seed(); await e.journal.admission({ kind: 'release', evidence: e.failed.evidence }); await f.close(e.journal);
  const db = initialize(e.path); schema12(db); db.close();
  const journal = await f.open(e.path); expect(await journal.readOutputDelivery(e.key)).toBeNull();
  expect(await journal.scanRunnable({ lane: 'delivery', limit: 32 })).toEqual({ attempts: [e.key], through: 1 });
  await f.close(journal); const state = inspect(e.path);
  expect(state.rows.find(row => row.table === 'accepted_attempts')!.rows[0]).toMatchObject({ delivery_bytes: 0, delivery_pending: 0 });
  for (const name of ['output_collection_intents', 'output_sources', 'output_delivery_closures']) expect(state.rows.find(row => row.table === name)!.rows).toEqual([]);
});
it.each(['table', 'commit'])('rolls back every migration013 DDL/data/flag/version/sequence on late %s fault', async kind => {
  const e = await f.nativeReady(); schema12(e.db);
  if (kind === 'table') e.db.exec('CREATE TABLE output_delivery_closures(canary TEXT)');
  else e.db.exec(`CREATE TABLE fault_parent(id PRIMARY KEY); CREATE TABLE fault_child(id REFERENCES fault_parent(id) DEFERRABLE INITIALLY DEFERRED);
    CREATE TRIGGER migration_fault AFTER UPDATE ON accepted_attempts BEGIN INSERT INTO fault_child VALUES(1); END;`);
  const graph = e.db.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY name').all();
  const before = e.db.prepare('SELECT * FROM accepted_attempts').all(); const sources = e.db.prepare('SELECT * FROM output_sources').all();
  const seq = e.db.prepare('SELECT * FROM sqlite_sequence ORDER BY name').all();
  expect(() => transaction(e.db, () => migration013(e.db))).toThrow();
  expect(e.db.prepare('PRAGMA user_version').get()?.user_version).toBe(12);
  expect(e.db.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY name').all()).toEqual(graph);
  expect(e.db.prepare('SELECT * FROM accepted_attempts').all()).toEqual(before);
  expect(e.db.prepare('SELECT * FROM output_sources').all()).toEqual(sources);
  expect(e.db.prepare('SELECT * FROM sqlite_sequence ORDER BY name').all()).toEqual(seq);
  expect(e.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});
it.each([4096, 4097])('bounds source-key preflight at %s without materializing source JSON or beginning DDL early', count => {
  // Isolated cardinality fixture only: these keys grant no source/native-file authority.
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE output_sources(attempt_id TEXT PRIMARY KEY,source_json TEXT)');
    const put = db.prepare('INSERT INTO output_sources VALUES(?,?)');
    for (let index = 0; index < count; index++) put.run(String(index).padStart(36, '0'), 'UNTRUSTED_CANARY');
    const prepare = vi.spyOn(db, 'prepare'); const ddl = vi.spyOn(db, 'exec').mockImplementation(() => { throw new Error('bounded DDL reached'); });
    if (count === 4097) { expect(() => migration013(db)).toThrow(expect.objectContaining({ code: 'unavailable' })); expect(ddl).not.toHaveBeenCalled(); }
    else { expect(() => migration013(db)).toThrow('bounded DDL reached'); expect(ddl).toHaveBeenCalledTimes(1); }
    expect(prepare.mock.calls.map(([query]) => query)).toEqual(['SELECT attempt_id FROM output_sources ORDER BY attempt_id LIMIT 4097']);
  } finally { db.close(); }
});
const changes = {
  authority: (v: OutputDeliveryClosure) => { Reflect.set(v.receipt, 'journalAuthority', '22222222-2222-4222-8222-222222222222'); },
  scope: (v: OutputDeliveryClosure) => { Reflect.set(v.receipt.key, 'workspaceId', v.receipt.key.attemptId); },
  manifest: (v: OutputDeliveryClosure) => { Reflect.set(v.receipt, 'manifestDigest', '0'.repeat(64)); },
  source: (v: OutputDeliveryClosure) => { Reflect.set(v.receipt, 'sourceDigest', '0'.repeat(64)); },
  sequence: (v: OutputDeliveryClosure) => { Reflect.set(v, 'finalAgentSeq', v.finalAgentSeq + 1); },
  text: (v: OutputDeliveryClosure) => { Reflect.set(v, 'finalAgentSeq', 'bad'); },
  fraction: (v: OutputDeliveryClosure) => { Reflect.set(v, 'finalAgentSeq', 1.5); },
  unsafe: (v: OutputDeliveryClosure) => { Reflect.set(v, 'finalAgentSeq', Number.MAX_SAFE_INTEGER + 1); },
  version: (v: OutputDeliveryClosure) => { Reflect.set(v, 'version', 2); },
  extra: (v: OutputDeliveryClosure) => { Reflect.set(v, 'extra', 1); },
  nested: (v: OutputDeliveryClosure) => { Reflect.set(v.receipt.key, 'extra', 1); },
};
it.each(Object.entries(changes))('native closure rejects %s forgery independently of worker, preserving rows/charge/marker/FKs', async (_, change) => {
  const e = await f.nativeReady(); const value = structuredClone(e.expected); change(value); const before = durableRows(e.db);
  expect(() => insertClosure(e.db, value)).toThrow('invalid output delivery');
  expect(durableRows(e.db)).toEqual(before); expect(e.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});
it.each([-1, 1])('native closure rejects incorrect charged byte delta %s atomically', async delta => {
  const e = await f.nativeReady(); const before = durableRows(e.db);
  expect(() => insertClosure(e.db, e.expected, Buffer.byteLength(json(e.expected)) + 256 + delta)).toThrow();
  expect(durableRows(e.db)).toEqual(before);
});
it('native closure refuses a real committed but physically charged source until exact stored release', async () => {
  const e = await f.native(); e.op({ kind: 'outputCollectionBegin', json: json(e.intent) }); e.op({ kind: 'outputSourceCommit', json: json(e.source) });
  const { receiptForOutputSource } = await import('../../src/output-source/index.js'); const { hash } = await import('./fixtures.js');
  const value = { version: 1 as const, receipt: receiptForOutputSource(e.source, hash), finalAgentSeq: Number(e.db.prepare('SELECT last_seq FROM accepted_attempts').get()?.last_seq) };
  const before = durableRows(e.db); expect(() => insertClosure(e.db, value)).toThrow('invalid output delivery'); expect(durableRows(e.db)).toEqual(before);
  e.op({ kind: 'outputSourceRelease', json: json(value.receipt) }); insertClosure(e.db, value);
  expect(e.db.prepare('SELECT delivery_pending FROM accepted_attempts').get()?.delivery_pending).toBe(0);
});
it.each([
  'UPDATE output_delivery_closures SET charged_bytes=charged_bytes+1', 'DELETE FROM output_delivery_closures',
  'INSERT OR REPLACE INTO output_delivery_closures SELECT * FROM output_delivery_closures',
  'REPLACE INTO output_delivery_closures SELECT * FROM output_delivery_closures',
  'INSERT OR IGNORE INTO output_delivery_closures SELECT * FROM output_delivery_closures',
  'UPDATE accepted_attempts SET delivery_bytes=delivery_bytes-1', 'UPDATE accepted_attempts SET delivery_pending=1',
  'UPDATE accepted_attempts SET last_seq=last_seq+1', 'UPDATE accepted_attempts SET supervisor_high=supervisor_high+1',
  'UPDATE accepted_attempts SET wrapper_high=wrapper_high+1', 'UPDATE accepted_attempts SET id=id+1',
  "UPDATE accepted_attempts SET result_json='{}'", "UPDATE accepted_attempts SET wrapper_checkpoint_json='{}',checkpoint_bytes=2",
  'INSERT INTO event_spool SELECT attempt_id,generation,seq+100,source,source_key+100,canonical_json,event_json,encoded_bytes,charged_bytes FROM event_spool LIMIT 1',
  'INSERT OR REPLACE INTO event_spool SELECT * FROM event_spool', 'UPDATE event_spool SET seq=seq+100',
])('native closed delivery fence rejects %s with recursive triggers off and exact state unchanged', async sql => {
  const e = await f.nativeReady(); insertClosure(e.db, e.expected); e.db.exec('PRAGMA recursive_triggers=OFF'); const before = durableRows(e.db);
  expect(() => e.db.exec(sql)).toThrow(); expect(durableRows(e.db)).toEqual(before); expect(e.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});
it('native byte gate rejects UTF8 overflow before JSON functions even with otherwise valid binding', async () => {
  const e = await f.nativeReady(); const value = 'é'.repeat(513); const before = durableRows(e.db);
  expect(() => e.db.prepare('INSERT INTO output_delivery_closures VALUES(?,?,?)').run(e.key.attemptId, value, Buffer.byteLength(value) + 256))
    .toThrow('invalid output delivery bytes'); expect(durableRows(e.db)).toEqual(before);
});
