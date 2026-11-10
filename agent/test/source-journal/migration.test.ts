import { DatabaseSync } from 'node:sqlite';
import type { SQLOutputValue } from 'node:sqlite';
import { expect, it, vi } from 'vitest';
import { initialize } from '../../src/journal/schema.js';
import { migration011 } from '../../src/journal/migration011.js';
import { migration012 } from '../../src/journal/migration012.js';
import { Store } from '../../src/journal/store.js';
import { transaction } from '../../src/journal/sql.js';
import { legacy, legacyRow } from '../disk-retention/fixtures.js';
import { sourceFixture, rows, json, hash } from './fixtures.js';
const f = sourceFixture();
it('applies real migration011 before additive012 without inventing old source authority', () => {
  const db = legacy(); const reservation = legacyRow(db); migration011(db);
  const before = db.prepare('SELECT * FROM reservations').all();
  transaction(db, () => migration012(db));
  expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(12);
  expect(db.prepare('SELECT * FROM reservations').all()).toEqual(before);
  expect(db.prepare('SELECT collection_bytes,source_bytes FROM accepted_attempts').all()).toEqual([{ collection_bytes: 0, source_bytes: 0 }]);
  const key = { attemptId: reservation.attemptId, organizationId: reservation.organizationId, workspaceId: reservation.workspaceId, generation: 1 };
  expect(new Store(db).execute({ kind: 'outputSourceRead', key, id: 1 })).toBeNull();
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});
it('rolls back all012 DDL/guards/columns/version on a late table collision', () => {
  const db = legacy(); migration011(db); db.exec('CREATE TABLE output_sources(canary TEXT);');
  const before = db.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY name').all();
  expect(() => transaction(db, () => migration012(db))).toThrow();
  expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(11);
  expect(db.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY name').all()).toEqual(before);
});
it('rejects future13 without touching the owned native file', () => {
  const path = f.path(); const seed = initialize(path); seed.exec('PRAGMA user_version=13'); seed.close();
  expect(() => initialize(path)).toThrow(expect.objectContaining({ code: 'schema_newer' }));
  const db = new DatabaseSync(path); try { expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(13); } finally { db.close(); }
});
it.each([
  "UPDATE output_sources SET source_json=json_set(source_json,'$.root.uid',2)",
  'DELETE FROM output_sources', 'INSERT OR REPLACE INTO output_sources SELECT * FROM output_sources',
  'REPLACE INTO output_sources SELECT * FROM output_sources', 'INSERT OR IGNORE INTO output_sources SELECT * FROM output_sources',
  "UPDATE output_collection_intents SET created_epoch='22222222-2222-4222-8222-222222222222'",
  "UPDATE output_collection_intents SET phase='pending'", 'DELETE FROM output_collection_intents',
  'INSERT OR REPLACE INTO output_collection_intents SELECT * FROM output_collection_intents',
  "UPDATE accepted_attempts SET result_json='{}'", "UPDATE accepted_attempts SET wrapper_checkpoint_json='{}',checkpoint_bytes=2",
  "UPDATE reservations SET reservation_json=json_set(reservation_json,'$.runtimeId','forged')",
])('native guards reject %s with recursive triggers off and exact rows/FKs preserved', async sql => {
  const e = await f.native(); e.op({ kind: 'outputCollectionBegin', json: json(e.intent) }); e.op({ kind: 'outputSourceCommit', json: json(e.source) });
  e.db.exec('PRAGMA recursive_triggers=OFF'); const before = rows(e.db);
  expect(() => e.db.exec(sql)).toThrow(); expect(rows(e.db)).toEqual(before); expect(e.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});
it.each(['sourced-missing', 'source-pending', 'failed-charged', 'counter'])('refuses persisted %s contradictions rather than returning absence', async kind => {
  const e = await f.native(); e.op({ kind: 'outputCollectionBegin', json: json(e.intent) });
  if (kind === 'source-pending') e.op({ kind: 'outputSourceCommit', json: json(e.source) });
  f.closeNative(e.db);
  // Deliberately untrusted native fixture, built without guards; no live guard is disabled.
  const broken = f.corruptCopy(e.path);
  if (kind === 'sourced-missing') broken.exec("UPDATE output_collection_intents SET phase='sourced'");
  if (kind === 'source-pending') broken.exec("UPDATE output_collection_intents SET phase='pending'");
  if (kind === 'failed-charged') broken.exec("UPDATE output_collection_intents SET phase='failed'");
  if (kind === 'counter') broken.exec('UPDATE accepted_attempts SET collection_bytes=0');
  const store = new Store(broken);
  for (const operation of ['outputSourceRead', 'outputCollectionRead'] as const) expect(() => store.execute({ kind: operation, key: e.key, id: 1 }))
    .toThrow(expect.objectContaining({ code: 'unavailable' }));
});
it.each(['spec', 'settlement', 'create', 'runtime'] as const)('native intent insertion refuses mismatched original %s facts atomically', async kind => {
  const e = await f.native(); const value = structuredClone(e.intent);
  const changes = {
    spec: () => { Reflect.set(value.binding, 'specDigest', '0'.repeat(64)); Reflect.set(value.launch, 'specDigest', '0'.repeat(64)); },
    settlement: () => { Reflect.set(value.launch, 'evidenceId', 'different'); },
    create: () => { Reflect.set(value.launch, 'createToken', 'different'); },
    runtime: () => { Reflect.set(value.launch, 'runtimeId', 'different'); },
  };
  changes[kind](); const text = json(value); const before = rows(e.db);
  expect(() => e.db.prepare(`INSERT INTO output_collection_intents(attempt_id,collection_id,intent_json,charged_bytes,phase,created_epoch)
    VALUES(?,?,?,?,'pending',?)`).run(e.key.attemptId, e.intent.collectionId, text, Buffer.byteLength(text) + 256,
    '22222222-2222-4222-8222-222222222222')).toThrow('invalid output intent');
  expect(rows(e.db)).toEqual(before);
});
it.each(['runtime', 'chronology', 'launch', 'scope'] as const)('native source insertion refuses rehashed %s disagreement with its intent', async kind => {
  const e = await f.native(); e.op({ kind: 'outputCollectionBegin', json: json(e.intent) }); const value = structuredClone(e.source);
  if (kind === 'runtime') Reflect.set(value.release.runtime, 'evidenceId', 'different');
  if (kind === 'chronology') Reflect.set(value.release.collection, 'observedAt', e.intent.begunAt - 1);
  if (kind === 'launch') Reflect.set(value.release.launch, 'settlementId', 'different');
  if (kind === 'scope') Reflect.set(value.release.key, 'workspaceId', e.key.attemptId);
  const core = { ...value }; Reflect.deleteProperty(core, 'sourceDigest');
  Reflect.set(value, 'sourceDigest', hash('beetle-lab.output-source.v1\n' + json(core)));
  const text = json(value); const before = rows(e.db);
  expect(() => e.db.prepare(`INSERT INTO output_sources(attempt_id,source_json,manifest_digest,source_digest,charged_bytes)
    VALUES(?,?,?,?,?)`).run(e.key.attemptId, text, value.manifest.manifestDigest, value.sourceDigest, Buffer.byteLength(text) + 256)).toThrow('invalid output source');
  expect(rows(e.db)).toEqual(before);
});
it.each(['json', 'digest', 'charge'] as const)('refuses malformed native source %s state', async kind => {
  const e = await f.native(); e.op({ kind: 'outputCollectionBegin', json: json(e.intent) }); e.op({ kind: 'outputSourceCommit', json: json(e.source) });
  f.closeNative(e.db); const broken = f.corruptCopy(e.path);
  if (kind === 'json') broken.exec("UPDATE output_sources SET source_json='not-json'");
  if (kind === 'digest') broken.prepare('UPDATE output_sources SET source_digest=?').run('0'.repeat(64));
  if (kind === 'charge') broken.exec('UPDATE output_sources SET charged_bytes=charged_bytes+1');
  expect(() => new Store(broken).execute({ kind: 'outputSourceRead', key: e.key, id: 1 }))
    .toThrow(expect.objectContaining({ code: 'unavailable' }));
});
it.each(['intent', 'source'] as const)('SQL CASE excludes oversized %s bytes before the native row crosses into Node', async kind => {
  const e = await f.native(); e.op({ kind: 'outputCollectionBegin', json: json(e.intent) }); e.op({ kind: 'outputSourceCommit', json: json(e.source) });
  f.closeNative(e.db); const broken = f.corruptCopy(e.path);
  const table = kind === 'intent' ? 'output_collection_intents' : 'output_sources'; const column = kind === 'intent' ? 'intent_json' : 'source_json';
  broken.prepare(`UPDATE ${table} SET ${column}=?`).run('x'.repeat(kind === 'intent' ? 32769 : 131073));
  const prepare = broken.prepare.bind(broken); const materialized: unknown[] = [];
  const spy = vi.spyOn(broken, 'prepare').mockImplementation(sql => {
    const statement = prepare(sql);
    if (sql.includes(`FROM ${table} WHERE attempt_id=?`) && sql.includes('AS json')) {
      const get = statement.get.bind(statement);
      vi.spyOn(statement, 'get').mockImplementation((...args) => {
        const row = Reflect.apply(get, statement, args) as Record<string, SQLOutputValue> | undefined;
        materialized.push(row?.json); return row;
      });
    }
    return statement;
  });
  try {
    expect(() => new Store(broken).execute({ kind: 'outputSourceRead', key: e.key, id: 1 })).toThrow(expect.objectContaining({ code: 'unavailable' }));
    expect(materialized).toEqual([null]);
  } finally { spy.mockRestore(); }
});
