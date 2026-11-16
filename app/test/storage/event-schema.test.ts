import { expect, it } from 'vitest';
import { transaction } from '../../src/adapters/outbound/sqlite/schema.js';
import { eventSchemaFixture } from './event-schema-fixtures.js';

it('requires retained acknowledged physical binding and zero initial event authority', () => {
  const f = eventSchemaFixture();
  for (const patch of [{ durable_through: 1, event_count: 1 }, { retained_bytes: 1 },
    { blocked_reason: 'missing_receipt' }, { coverage: 'partial' }, { journal_authority: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }]) {
    expect(() => f.create(patch)).toThrow();
  }
  expect(f.db.prepare('SELECT count(*) AS n FROM event_cursors').get()?.n).toBe(0);
  f.create(); expect(f.cursor()).toMatchObject({ durable_through: 0, ack_confirmed_through: 0, event_count: 0, retained_bytes: 0 });
  expect(() => f.create()).toThrow();
});

it('does not create cursor authority for an unacknowledged original', () => {
  const f = eventSchemaFixture(1000, false);
  expect(() => f.create()).toThrow();
  expect(f.db.prepare('SELECT count(*) AS n FROM event_cursors').get()?.n).toBe(0);
});

it('couples immutable contiguous rows and byte counters before durable cursor and ACK can advance', () => {
  const f = eventSchemaFixture(); f.create(); const usage = f.db.prepare('SELECT * FROM installation_storage_usage').all();
  expect(() => f.db.exec('UPDATE event_cursors SET event_count=1,retained_bytes=1')).toThrow();
  expect(() => f.db.exec('UPDATE event_cursors SET durable_through=1')).toThrow();
  expect(() => f.db.exec('UPDATE event_cursors SET ack_confirmed_through=1')).toThrow();
  const record = f.append();
  expect(f.cursor()).toMatchObject({ durable_through: 1, event_count: 1, retained_bytes: record.chargedBytes });
  expect(() => f.db.exec('UPDATE event_cursors SET ack_confirmed_through=2')).toThrow();
  f.db.exec('UPDATE event_cursors SET durable_through=1,ack_confirmed_through=1');
  expect(() => f.db.exec('UPDATE event_cursors SET durable_through=0')).toThrow();
  expect(() => f.db.exec('UPDATE event_cursors SET ack_confirmed_through=0')).toThrow();
  expect(() => f.db.exec('UPDATE event_cursors SET retained_bytes=retained_bytes+1')).toThrow();
  expect(f.db.prepare('SELECT * FROM installation_storage_usage').all()).toEqual(usage);
  expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});

it('preserves retained rows/cursor against replace, update, deletion and unsupported stream closure', () => {
  const f = eventSchemaFixture(); f.create(); f.append();
  for (const sql of ['INSERT OR REPLACE INTO run_events SELECT * FROM run_events',
    'INSERT OR REPLACE INTO event_cursors SELECT * FROM event_cursors',
    'UPDATE run_events SET canonical_json=canonical_json', 'DELETE FROM run_events', 'DELETE FROM event_cursors',
    'UPDATE execution_records SET event_pending=0']) expect(() => f.db.exec(sql)).toThrow();
  expect(() => f.append(1)).toThrow(); expect(() => f.append(3)).toThrow();
  expect(f.cursor()).toMatchObject({ event_count: 1 });
});

it('uses the exact owned output allowance without a second installation charge', () => {
  const sample = eventSchemaFixture(); const bytes = sample.event().chargedBytes;
  expect(bytes).toBeLessThanOrEqual(1000);
  const f = eventSchemaFixture(bytes); f.create(); const usage = f.db.prepare('SELECT * FROM installation_storage_usage').all();
  f.append(); expect(f.cursor().retained_bytes).toBe(bytes);
  expect(() => f.append(2)).toThrow();
  expect(f.db.prepare('SELECT * FROM installation_storage_usage').all()).toEqual(usage);
});

it('rolls back row, counters and cursor after a late write failure', () => {
  const f = eventSchemaFixture(); f.create(); const before = f.cursor();
  expect(() => transaction(f.db, () => { f.append(); f.db.exec('UPDATE event_cursors SET durable_through=1');
    f.db.exec('UPDATE event_cursors SET ack_confirmed_through=2'); })).toThrow();
  expect(f.cursor()).toEqual(before); expect(f.db.prepare('SELECT count(*) AS n FROM run_events').get()?.n).toBe(0);
});

it('refuses false partial coverage and retains first blocked evidence without clearing it', () => {
  const f = eventSchemaFixture(); f.create();
  expect(() => f.db.exec("UPDATE event_cursors SET coverage='partial'")).toThrow();
  expect(() => f.db.exec("UPDATE event_cursors SET coverage='partial',blocked_reason='cursor_expired',retained_start_seq=1")).toThrow();
  f.db.exec("UPDATE event_cursors SET coverage='partial',blocked_reason='cursor_expired',retained_start_seq=2");
  expect(() => f.db.exec("UPDATE event_cursors SET coverage='contiguous',blocked_reason=NULL,retained_start_seq=NULL")).toThrow();
  expect(() => f.db.exec('UPDATE event_cursors SET retained_start_seq=3')).toThrow();
  expect(() => f.append()).toThrow();
});

it('keeps the indexed obligation after matched physical release and outbox retirement', () => {
  const f = eventSchemaFixture(); f.create(); f.release(f.binding.key);
  expect(f.db.prepare('SELECT execution_charged,event_pending FROM execution_records').get())
    .toEqual({ execution_charged: 0, event_pending: 1 });
  expect(f.db.prepare('SELECT count(*) AS n FROM dispatch_outbox').get()?.n).toBe(0);
  const plan = f.db.prepare(`EXPLAIN QUERY PLAN SELECT attempt_id,queue_order FROM execution_records
    INDEXED BY execution_event_pending WHERE acknowledged_generation=1 AND event_pending=1
    AND queue_order>0 ORDER BY queue_order,attempt_id LIMIT 33`).all();
  expect(plan.some(row => String(row.detail).includes('execution_event_pending'))).toBe(true);
  f.append(); expect(f.cursor().event_count).toBe(1);
});

it('requires a new event obligation instead of accepting explicit closure at record birth', () => {
  expect(() => eventSchemaFixture(1000, true, 0)).toThrow('new event obligation required');
});
it.each([undefined, 1])('keeps omitted/explicit pending%s discoverable after acknowledgment and release', pending => {
  const f = eventSchemaFixture(1000, true, pending); f.release(f.binding.key);
  expect(f.db.prepare(`SELECT event_pending,execution_charged FROM execution_records INDEXED BY execution_event_pending
    WHERE acknowledged_generation=1 AND event_pending=1`).all())
    .toEqual([{ event_pending: 1, execution_charged: 0 }]);
  f.create(); expect(f.cursor().durable_through).toBe(0);
});
