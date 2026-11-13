import { expect, it } from 'vitest';
import { initialize, transaction } from '../../src/adapters/outbound/sqlite/schema.js';
import { reserveRunOutput } from '../../src/adapters/outbound/sqlite/output-reservations.js';
import { seedFoundation, enqueue, insertRecord, reserveAndMark, snapshotFor } from './execution-foundation-fixtures.js';
import { uuid } from './fixture.js';
it('requires all claim counterparts at commit and rolls back usage', () => {
  const db = initialize(':memory:');
  try {
    const { key } = enqueue(db, seedFoundation(db));
    expect(() => db.exec("UPDATE dispatch_outbox SET possible_delivery=1,first_delivery_at='synthetic'")).toThrow();
    expect(() => transaction(db, () => insertRecord(db, key))).toThrow();
    expect(() => transaction(db, () => { insertRecord(db, key); reserveRunOutput(db, key, { allocationBytes: 1e9, reserveBytes: 0 }); })).toThrow();
    expect(db.prepare('SELECT charged_bytes FROM installation_storage_usage').get()?.charged_bytes).toBe(0);
    expect(db.prepare('SELECT count(*) n FROM execution_records').get()?.n).toBe(0);
    expect(() => reserveRunOutput(db, key, { allocationBytes: 1e9, reserveBytes: 0 })).toThrow();
    transaction(db, () => reserveAndMark(db, key));
    for (const table of ['execution_records', 'attempt_output_allocations']) {
      expect(() => db.exec(`INSERT OR REPLACE INTO ${table} SELECT * FROM ${table}`)).toThrow();
      expect(() => db.exec(`DELETE FROM ${table}`)).toThrow();
    }
    for (const column of ['version', 'maximum_payload_bytes', 'charged_bytes']) expect(() => db.exec(`UPDATE attempt_output_allocations SET ${column}=2`)).toThrow();
    expect(() => db.exec('UPDATE attempts SET generation=1')).toThrow();
    expect(() => db.exec('DELETE FROM dispatch_outbox')).toThrow();
  } finally { db.close(); }
});
it('rejects wrong scope, missing references and contradictory or oversized snapshots', () => {
  const db = initialize(':memory:');
  try {
    const { key } = enqueue(db, seedFoundation(db));
    expect(() => transaction(db, () => { insertRecord(db, key); reserveRunOutput(db, { ...key, runId: uuid(999) }, { allocationBytes: 1e9, reserveBytes: 0 }); })).toThrow();
    expect(() => transaction(db, () => { insertRecord(db, key); db.exec('UPDATE execution_records SET queue_order=900'); })).toThrow();
    transaction(db, () => reserveAndMark(db, key));
    for (const patch of [{ attemptId: uuid(999) }, { generation: 2 }, { organizationId: uuid(999) }, { lastSeq: -1 }, { retainedStartSeq: 1.5 }, { extra: 'x'.repeat(73728) }]) {
      expect(() => db.prepare('UPDATE execution_records SET acknowledged_generation=1,snapshot_json=?').run(JSON.stringify({ ...snapshotFor(key), ...patch }))).toThrow();
    }
    expect(() => db.exec('UPDATE attempts SET execution_intent_id=NULL')).toThrow();
    expect(() => db.exec('UPDATE dispatch_outbox SET execution_intent_id=NULL')).toThrow();
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); }
});
it('bounds charged ownership at64 without charging the65th output', () => {
  const db = initialize(':memory:');
  try {
    const store = seedFoundation(db,10000000);
    for (let i = 0; i < 64; i++) { const { key } = enqueue(db, store, 1000 + i); transaction(db, () => reserveAndMark(db, key)); }
    const before = db.prepare('SELECT charged_bytes FROM installation_storage_usage').get();
    const { key } = enqueue(db, store, 1064);
    expect(() => transaction(db, () => reserveAndMark(db, key))).toThrow();
    expect(db.prepare('SELECT charged_bytes FROM installation_storage_usage').get()).toEqual(before);
  } finally { db.close(); }
});
it('rejects acknowledging and deleting an original whose delivery was never marked possible', () => {
  const db = initialize(':memory:');
  try {
    const { key } = enqueue(db, seedFoundation(db));
    const outbox = db.prepare('SELECT * FROM dispatch_outbox').all();
    const attempts = db.prepare('SELECT * FROM attempts').all();
    const usage = db.prepare('SELECT * FROM installation_storage_usage').all();
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(() => transaction(db, () => {
      insertRecord(db, key);
      reserveRunOutput(db, key, { allocationBytes: 1e9, reserveBytes: 0 });
      expect(db.prepare('SELECT possible_delivery,first_delivery_at FROM dispatch_outbox').get())
        .toEqual({ possible_delivery: 0, first_delivery_at: null });
      // Exact matched snapshot/ACK/detach/delete sequence; no possible mark precedes it.
      db.prepare('UPDATE execution_records SET snapshot_json=?,acknowledged_generation=1,delivery_attempt_id=NULL WHERE attempt_id=?')
        .run(JSON.stringify(snapshotFor(key)), key.attempt.attemptId);
      db.prepare('UPDATE attempts SET generation=1 WHERE id=?').run(key.attempt.attemptId);
      db.prepare('DELETE FROM dispatch_outbox WHERE attempt_id=?').run(key.attempt.attemptId);
    })).toThrow();
    expect(db.prepare('SELECT * FROM dispatch_outbox').all()).toEqual(outbox);
    expect(db.prepare('SELECT * FROM attempts').all()).toEqual(attempts);
    expect(db.prepare('SELECT * FROM installation_storage_usage').all()).toEqual(usage);
    expect(db.prepare('SELECT * FROM execution_records').all()).toEqual([]);
    expect(db.prepare('SELECT * FROM attempt_output_allocations').all()).toEqual([]);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); }
});
