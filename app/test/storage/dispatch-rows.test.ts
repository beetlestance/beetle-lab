import { expect, it } from 'vitest';
import {
  captureObservationRow,
  captureDeliveryRow,
  observationColumns,
  deliveryColumns,
} from '../../src/adapters/outbound/sqlite/dispatch-rows.js';
import { DatabaseSync } from 'node:sqlite';
import { uuid } from './fixture.js';
const record = {
  journal_authority: uuid(300),
  snapshot_bytes: null,
  snapshot_json: null,
  result_observed: 0,
  execution_charged: 0,
  acknowledged_generation: null,
  delivery_attempt_id: uuid(70),
  generation: null,
};
it('preserves a valid unacknowledged observation and its authority', () => {
  expect(captureObservationRow(record)).toEqual(record);
});
it.each([
  { result_observed: 2 },
  { execution_charged: '0' },
  { journal_authority: 'invalid' },
  { snapshot_bytes:2049,snapshot_json:'x'.repeat(2049) },
  { snapshot_bytes: 0, snapshot_json: null },
  { snapshot_bytes: 1, snapshot_json: '{}' },
  { snapshot_bytes: 2, snapshot_json: Buffer.from('{}') },
  { acknowledged_generation: 2 },
  { generation: '1' },
  { delivery_attempt_id: 'invalid' },
])('refuses malformed observation row facts %j', (amendment) => {
  expect(() => captureObservationRow({ ...record, ...amendment })).toThrow();
});
it('validates delivery flags, timestamps and immutable identities', () => {
  const delivery = {
    intent_digest: 'a'.repeat(64),
    execution_intent_id: uuid(70),
    possible_delivery: 1,
    first_delivery_at: '2026-11-09T00:00:00.000Z',
  };
  expect(captureDeliveryRow(delivery)).toEqual(delivery);
  expect(captureDeliveryRow(undefined)).toBeUndefined();
  expect(() => captureDeliveryRow({ ...delivery, possible_delivery: 2 })).toThrow();
  expect(() => captureDeliveryRow({ ...delivery, first_delivery_at: 'invalid' })).toThrow();
  expect(() => captureDeliveryRow({ ...delivery, intent_digest: 'invalid' })).toThrow();
});
it('bounds all observed text and numeric cells inside SQLite', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(
      'CREATE TABLE execution_records(snapshot_json,journal_authority,result_observed,execution_charged,acknowledged_generation,delivery_attempt_id); CREATE TABLE attempts(generation)',
    );
    db.prepare('INSERT INTO execution_records VALUES(?,?,?,?,?,?)').run(
      'X'.repeat(1000000),
      uuid(300),
      2,
      Buffer.alloc(1000000),
      null,
      uuid(70),
    );
    db.prepare('INSERT INTO attempts VALUES(?)').run(null);
    const row = db.prepare(`SELECT ${observationColumns} FROM execution_records e CROSS JOIN attempts a`).get();
    expect(row?.snapshot_json).toBe('');
    expect(row?.snapshot_bytes).toBe(1000000);
    expect(row?.execution_charged).toBeNull();
    expect(() => captureObservationRow(row)).toThrow();
    db.exec('CREATE TABLE dispatch_outbox(intent_digest,execution_intent_id,possible_delivery,first_delivery_at)');
    db.prepare('INSERT INTO dispatch_outbox VALUES(?,?,?,?)').run('a'.repeat(64), uuid(70), 1, Buffer.alloc(1000000));
    expect(db.prepare(`SELECT ${deliveryColumns} FROM dispatch_outbox`).get()?.first_delivery_at).toBe('');
  } finally {
    db.close();
  }
});
