import { afterEach, beforeEach, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareEventBatch } from '../../src/domain/events/index.js';
import { request } from './events/fixtures.js';
import { initialize } from '../../src/adapters/outbound/sqlite/schema.js';
import { DispatchObservations } from '../../src/adapters/outbound/sqlite/dispatch-observations.js';
import { RunReads } from '../../src/adapters/outbound/sqlite/run-reads.js';
import { Suites } from '../../src/adapters/outbound/sqlite/suites.js';
import { Entities } from '../../src/adapters/outbound/sqlite/entities.js';
import { legacyPayload, oldFacts } from './output-payload-migration-fixtures.js';
let root = '';
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'beetle-output-payload-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

it('converts and reopens actual schema7 without duplicating result or changing receipt/release/counters', () => {
  const path = join(root, 'metadata.sqlite'); const old = legacyPayload(path); const binding = { key: old.key, journalAuthority: '33333333-3333-4333-8333-333333333333' };
  const event = prepareEventBatch(request(binding)).records[0]!;
  old.db.prepare(`INSERT INTO event_cursors(attempt_id,run_id,organization_id,workspace_id,intent_digest,journal_authority,generation)
    VALUES(?,?,?,?,?,?,1)`).run(old.key.attempt.attemptId, old.key.runId, old.key.attempt.organizationId,
      old.key.attempt.workspaceId, old.key.attempt.intentDigest, binding.journalAuthority);
  old.db.prepare('INSERT INTO run_events VALUES(?,1,1,?,?,?)').run(old.key.attempt.attemptId, event.canonical, event.chargedBytes, event.chargedBytes);
  const before = oldFacts(old.db); old.db.close();
  let db = initialize(path);
  try {
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(11);
    expect(oldFacts(db).slice(1)).toEqual(before.slice(1));
    const observations = new DispatchObservations(db, new RunReads(db, new Suites(db, new Entities(db))));
    expect(observations.observe({ key: old.key, journalAuthority: '33333333-3333-4333-8333-333333333333', snapshot: old.snapshot }).snapshot).toEqual(old.snapshot);
    const row = db.prepare('SELECT snapshot_json,result_observed,execution_charged FROM execution_records').get()!;
    expect(JSON.parse(String(row.snapshot_json))).not.toHaveProperty('result'); expect(row).toMatchObject({ result_observed: 1, execution_charged: 0 });
    expect(db.prepare('SELECT count(*) n FROM execution_output_payloads').get()?.n).toBe(1);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); }
  db = initialize(path);
  try { expect(db.prepare('SELECT result_observed FROM execution_records').get()?.result_observed).toBe(1); expect(db.prepare('SELECT kind FROM execution_output_payloads').get()?.kind).toBe('result'); }
  finally { db.close(); }
});
it.each(['debt', 'unbound', 'invalid', 'late DDL', 'late guard'] as const)('migration %s failure preserves every original row/schema/version', failure => {
  const path = join(root, 'failed.sqlite'); const old = legacyPayload(path, { maximum: failure === 'debt' ? 1 : 10000, bound: failure !== 'unbound' });
  if (failure === 'invalid') old.db.prepare('UPDATE execution_records SET snapshot_json=json_set(snapshot_json,\'$.extra\',1)').run();
  if (failure === 'late DDL') old.db.exec('CREATE TABLE execution_output_payloads(canary TEXT);');
  if (failure === 'late guard') old.db.exec("CREATE TRIGGER output_payload_insert BEFORE UPDATE ON runs BEGIN SELECT RAISE(ABORT,'synthetic conflict'); END;");
  const facts = oldFacts(old.db); const schema = old.db.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY type,name').all(); old.db.close();
  expect(() => initialize(path)).toThrow(); const db = new DatabaseSync(path);
  try {
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(7);
    expect(oldFacts(db)).toEqual(facts); expect(db.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY type,name').all()).toEqual(schema);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); }
});
it('keeps an old unbound result-free header without relaxing its immutable authority guard', () => {
  const path = join(root, 'unbound-header.sqlite'); const old = legacyPayload(path, { bound: false, body: false }); old.db.close();
  const db = initialize(path);
  try {
    expect(db.prepare('SELECT journal_authority,result_observed FROM execution_records').get()).toEqual({ journal_authority: null, result_observed: 0 });
    expect(() => db.exec('UPDATE execution_records SET snapshot_json=snapshot_json')).toThrow('immutable delivery authority');
  } finally { db.close(); }
});
it('rejects future schema12 and preserves its version', () => {
  const path = join(root, 'future.sqlite'); const db = new DatabaseSync(path); db.exec('PRAGMA user_version=12'); db.close();
  expect(() => initialize(path)).toThrow(); const read = new DatabaseSync(path);
  try { expect(read.prepare('PRAGMA user_version').get()?.user_version).toBe(12); } finally { read.close(); }
});
it.each(['padded', 'duplicate-key'] as const)('fails intact on a stored result-free %s header that the new reader would refuse', mode => {
  const path = join(root, 'raw-header.sqlite'); const old = legacyPayload(path, { body: false });
  const text = String(old.db.prepare('SELECT snapshot_json FROM execution_records').get()?.snapshot_json);
  const raw = mode === 'padded' ? ' '.repeat(2048) + text : text.slice(0, -1) + ',"state":"exited"}';
  old.db.prepare('UPDATE execution_records SET snapshot_json=?').run(raw);
  expect(old.db.prepare('SELECT json_valid(snapshot_json) AS valid FROM execution_records').get()?.valid).toBe(1);
  const facts = oldFacts(old.db); const schema = old.db.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY type,name').all(); old.db.close();
  let opened: DatabaseSync | undefined;
  try { expect(() => { opened = initialize(path); }).toThrow(); } finally { opened?.close(); }
  const db = new DatabaseSync(path);
  try {
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(7);
    expect(oldFacts(db)).toEqual(facts); expect(db.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY type,name').all()).toEqual(schema);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); }
});
