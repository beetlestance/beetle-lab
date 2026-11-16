import { expect, it } from 'vitest';
import { owner, quotaUsed } from '../../src/journal/sql.js';
import { Store } from '../../src/journal/store.js';
import { deliveryFixture, durableRows, json, used } from './fixtures.js';
const f = deliveryFixture();

it.each([0, 1])('preflights all seven actual charges with %s byte short and exact replay', async short => {
  const e = await f.nativeReady(); const initial = used(e.db); const charge = Buffer.byteLength(json(e.expected)) + 256;
  e.db.prepare('UPDATE accepted_attempts SET quota_bytes=?').run(initial + charge - short);
  const before = durableRows(e.db); const issue = () => e.delivery({ kind: 'outputDeliveryClose', json: json(e.receipt) });
  if (short) { expect(issue).toThrow(expect.objectContaining({ code: 'quota_exceeded' })); expect(durableRows(e.db)).toEqual(before); }
  else { expect(issue()).toEqual(e.expected); expect(used(e.db)).toBe(initial + charge); expect(issue()).toEqual(e.expected); }
});
it('native charge guard independently enforces one-byte-short quota and rolls back marker and child', async () => {
  const e = await f.nativeReady(); const text = json(e.expected); const charge = Buffer.byteLength(text) + 256;
  e.db.prepare('UPDATE accepted_attempts SET quota_bytes=?').run(used(e.db) + charge - 1); const before = durableRows(e.db);
  expect(() => e.db.prepare('INSERT INTO output_delivery_closures VALUES(?,?,?)').run(e.key.attemptId, text, charge)).toThrow();
  expect(durableRows(e.db)).toEqual(before); expect(e.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});
it('keeps seventh charge across actual worker ACK/prune/release replay/reopen', async () => {
  const e = await f.ready(); const closure = await e.journal.closeOutputDelivery(e.receipt);
  await e.journal.acknowledge({ protocolVersion: '1.0', ...e.key, throughSeq: closure.finalAgentSeq });
  await e.journal.prune(e.key); await e.journal.releaseOutputSource(e.receipt); await f.close(e.journal);
  const reopened = await f.open(e.path); expect(await reopened.closeOutputDelivery(e.receipt)).toEqual(closure); await f.close(reopened);
  const db = (await import('node:sqlite')).DatabaseSync; const native = new db(e.path, { readOnly: true });
  try {
    expect(native.prepare('SELECT delivery_bytes,delivery_pending,spool_bytes FROM accepted_attempts').get()).toEqual({
      delivery_bytes: Buffer.byteLength(json(closure)) + 256, delivery_pending: 0, spool_bytes: 0 });
    expect(native.prepare('SELECT phase FROM disk_holds').get()?.phase).toBe('retained');
    expect(native.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { native.close(); }
});
it('preserves quota denial until genuine ACK/prune creates headroom, then closes without new producers', async () => {
  const e = await f.nativeReady(); const initial = used(e.db); const charge = Buffer.byteLength(json(e.expected)) + 256;
  e.db.prepare('UPDATE accepted_attempts SET quota_bytes=?').run(initial + charge - 1);
  expect(() => e.delivery({ kind: 'outputDeliveryClose', json: json(e.receipt) })).toThrow(expect.objectContaining({ code: 'quota_exceeded' }));
  e.store.execute({ kind: 'ack', id: 2, ack: { protocolVersion: '1.0', ...e.key, throughSeq: e.expected.finalAgentSeq } });
  e.store.execute({ kind: 'prune', id: 3, key: e.key });
  expect(e.delivery({ kind: 'outputDeliveryClose', json: json(e.receipt) })).toEqual(e.expected);
  expect(used(e.db)).toBeLessThan(initial + charge); expect(e.db.prepare('SELECT delivery_pending FROM accepted_attempts').get()?.delivery_pending).toBe(0);
});
it('requires every seventh counter rather than inventing zero in an untrusted native copy', async () => {
  const e = await f.nativeReady(); const row = owner(e.db, e.key); const missing = { ...row };
  Reflect.deleteProperty(missing, 'delivery_bytes');
  expect(() => quotaUsed(missing)).toThrow(expect.objectContaining({ code: 'unavailable' }));
  f.closeNative(e.db); const broken = f.corruptCopy(e.path); broken.exec("UPDATE accepted_attempts SET delivery_bytes='bad'");
  expect(() => new Store(broken).execute({ kind: 'outputDeliveryRead', key: e.key, id: 1 }))
    .toThrow(expect.objectContaining({ code: 'unavailable' }));
});
