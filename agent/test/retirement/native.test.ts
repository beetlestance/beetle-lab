import { expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { encodeCanonicalJson } from '@beetle/contracts';
import { initialize } from '../../src/journal/schema.js';
import { makeRetirementIntent } from '../../src/retirement-values/index.js';
import type { RetirementIntent } from '../../src/retirement-values/index.js';
import { RetirementStore } from '../../src/journal/retirement/index.js';
import { asSchema16 } from './legacy.js';
import { retirementFixture } from './fixtures.js';
const f = retirementFixture();
function insert(db: DatabaseSync, intent: RetirementIntent, verb = 'INSERT') {
  return db.prepare(`${verb} INTO output_retirement_intents(attempt_id,request_digest,namespace_identity,task_namespace_identity,intent_json)
    VALUES(?,?,?,?,?)`).run(intent.request.attemptId, intent.requestDigest, intent.namespaceIdentity,
      intent.task.state === 'prepared' ? intent.task.taskNamespaceIdentity : null, encodeCanonicalJson(intent, 4096));
}
it('raw SQL requires exact closure/authority and refuses replacing, editing or deleting a retirement original', async () => {
  const v = await f.ready(); const intent = await v.journal.retirements.preflight(v.request); await f.close(v.journal);
  const db = initialize(v.path);
  try {
    if (v.request.closure.kind !== 'absence') throw new Error('Expected absence fixture');
    const changed = makeRetirementIntent({ ...intent, request: { ...v.request,
      closure: { ...v.request.closure, proofDigest: 'f'.repeat(64) } } });
    expect(() => insert(db, changed)).toThrow('invalid retirement original');
    const foreign = makeRetirementIntent({ ...intent, request: { ...v.request, journalAuthority: v.request.runId } });
    expect(() => insert(db, foreign)).toThrow('invalid retirement original');
    insert(db, intent);
    expect(() => insert(db, intent, 'INSERT OR REPLACE')).toThrow('invalid retirement original');
    expect(() => db.exec('UPDATE output_retirement_intents SET intent_json=intent_json')).toThrow('immutable');
    expect(() => db.exec('DELETE FROM output_retirement_intents')).toThrow('retained');
    expect(() => db.exec(`INSERT INTO event_spool SELECT attempt_id,generation,seq+1,source,source_key+1,canonical_json,event_json,
      encoded_bytes,charged_bytes FROM event_spool`)).toThrow('retired producer');
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); }
});
it('migrates actual schema16 additively preserving rows, schema roots, foreign keys and charged disk custody', async () => {
  const v = await f.ready(); await f.close(v.journal); let db = initialize(v.path); asSchema16(db);
  const before = db.prepare("SELECT name,type,sql,rootpage FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();
  const original = db.prepare('SELECT * FROM accepted_attempts').all(); const held = db.prepare('SELECT * FROM disk_holds').all(); db.close();
  db = initialize(v.path);
  try {
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(17);
    for (const row of before) {
      if (typeof row.name !== 'string') throw new Error('Missing schema name');
      expect(db.prepare('SELECT name,type,sql,rootpage FROM sqlite_schema WHERE name=?').get(row.name)).toEqual(row);
    }
    expect(db.prepare('SELECT * FROM accepted_attempts').all()).toEqual(original);
    expect(db.prepare('SELECT * FROM disk_holds').all()).toEqual(held);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(new RetirementStore(db).execute({ kind: 'retirementOpen', id: 1, key: v.key })).toEqual({ key: v.key, open: true });
  } finally { db.close(); }
});
it('rejects oversized/private worker commands without parsing an unbounded request', async () => {
  const v = await f.ready(); await f.close(v.journal); const db = initialize(v.path); const store = new RetirementStore(db);
  try {
    for (const command of [{ kind: 'retirementRead', id: 1, json: JSON.stringify(v.request) },
      { kind: 'retirementBegin', id: 1, key: v.key }]) {
      expect(() => store.execute(command as never)).toThrow('invalid_input');
    }
    expect(() => store.execute({ kind: 'retirementBegin', id: 1, json: 'x'.repeat(5000) })).toThrow('invalid_input');
    expect(() => store.execute({ kind: 'retirementRead', id: 1, key: { ...v.key, generation: 2 } })).toThrow('stale_generation');
    expect(store.execute({ kind: 'retirementRead', id: 2, key: v.key })).toEqual({ key: v.key, intent: null });
  } finally { db.close(); }
});
