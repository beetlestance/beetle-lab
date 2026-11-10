import { expect, it } from 'vitest';
import { Store } from '../../src/journal/store.js';
import { receiptForOutputSource } from '../../src/output-source/index.js';
import { deliveryFixture, durableRows, hash, inspect, json } from './fixtures.js';
const f = deliveryFixture();

it('closes actual compiled source only after its exact release and preserves worker sequence, charge, immutable read and reopen', async () => {
  const e = await f.seed(); const receipt = receiptForOutputSource(e.source, hash);
  expect(await e.journal.readOutputDelivery(e.key)).toBeNull();
  await expect(e.journal.closeOutputDelivery(receipt)).rejects.toMatchObject({ code: 'conflict' });
  await e.journal.beginOutputCollection(e.intent); await e.journal.commitOutputSource(e.collected);
  expect(await e.journal.readOutputDelivery(e.key)).toBeNull();
  await expect(e.journal.closeOutputDelivery(receipt)).rejects.toMatchObject({ code: 'conflict' });
  await e.journal.releaseOutputSource(receipt);
  const last = (await e.journal.get(e.key)).lastSeq;
  const closure = await e.journal.closeOutputDelivery(receipt);
  expect(closure).toEqual({ version: 1, receipt, finalAgentSeq: last });
  expect(Object.isFrozen(closure) && Object.isFrozen(closure.receipt) && Object.isFrozen(closure.receipt.key)).toBe(true);
  expect(await e.journal.readOutputDelivery(e.key)).toEqual(closure);
  expect(await e.journal.closeOutputDelivery(receipt)).toEqual(closure);
  await f.close(e.journal); const before = inspect(e.path);
  const settings = before.rows.find(row => row.table === 'admission_settings')!.rows[0]!;
  expect(typeof settings.observation_json).toBe('string'); settings.observation_json = null;
  const reopened = await f.open(e.path);
  expect(await reopened.readOutputDelivery(e.key)).toEqual(closure);
  expect(await reopened.closeOutputDelivery(receipt)).toEqual(closure);
  await f.close(reopened); expect(inspect(e.path)).toEqual(before);
  const parent = before.rows.find(row => row.table === 'accepted_attempts')!.rows[0]!;
  expect(parent.delivery_bytes).toBe(Buffer.byteLength(json(closure)) + 256); expect(parent.delivery_pending).toBe(0);
  expect(before.foreignKeys).toEqual([]);
});
it.each(['authority', 'manifest', 'source'] as const)('rejects changed %s receipt before and after closure without changing any row', async kind => {
  const e = await f.ready(); const changed = { ...e.receipt };
  const names = { authority: 'journalAuthority', manifest: 'manifestDigest', source: 'sourceDigest' } as const;
  Reflect.set(changed, names[kind], kind === 'authority' ? '22222222-2222-4222-8222-222222222222' : '0'.repeat(64));
  await expect(e.journal.closeOutputDelivery(changed)).rejects.toMatchObject({ code: 'conflict' });
  const closure = await e.journal.closeOutputDelivery(e.receipt);
  await expect(e.journal.closeOutputDelivery(changed)).rejects.toMatchObject({ code: 'conflict' });
  expect(await e.journal.readOutputDelivery(e.key)).toEqual(closure);
});
it('retains typed unknown/stale scope errors and never closes old released rows without a source', async () => {
  const e = await f.seed();
  await expect(e.journal.readOutputDelivery({ ...e.key, generation: 2 })).rejects.toMatchObject({ code: 'stale_generation' });
  await expect(e.journal.readOutputDelivery({ ...e.key, workspaceId: e.key.attemptId })).rejects.toMatchObject({ code: 'not_found' });
  const receipt = receiptForOutputSource(e.source, hash);
  await expect(e.journal.closeOutputDelivery({ ...receipt, key: { ...receipt.key, workspaceId: e.key.attemptId } })).rejects.toMatchObject({ code: 'not_found' });
  await e.journal.admission({ kind: 'release', evidence: e.failed.evidence });
  expect(await e.journal.readOutputDelivery(e.key)).toBeNull();
  await expect(e.journal.closeOutputDelivery(receipt)).rejects.toMatchObject({ code: 'conflict' });
  await f.close(e.journal);
  expect(inspect(e.path).rows.find(row => row.table === 'output_delivery_closures')!.rows).toEqual([]);
});
it.each(['trigger', 'commit'])('rolls back the complete closure/charge/marker on a genuine late %s failure', async kind => {
  const e = await f.nativeReady();
  if (kind === 'trigger') e.db.exec(`CREATE TRIGGER late_delivery AFTER INSERT ON output_delivery_closures
    BEGIN SELECT RAISE(ABORT,'synthetic late delivery failure'); END;`);
  else e.db.exec(`CREATE TABLE fault_parent(id PRIMARY KEY); CREATE TABLE fault_child(id REFERENCES fault_parent(id) DEFERRABLE INITIALLY DEFERRED);
    CREATE TRIGGER late_delivery AFTER INSERT ON output_delivery_closures BEGIN INSERT INTO fault_child VALUES(1); END;`);
  const before = durableRows(e.db);
  expect(() => e.delivery({ kind: 'outputDeliveryClose', json: json(e.receipt) })).toThrow();
  expect(durableRows(e.db)).toEqual(before); expect(e.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});
it('allows exact existing supervisor replay and metadata cancellation/ACK/prune without advancing the fixed end', async () => {
  const e = await f.ready(); const prior = await e.journal.readEvents(e.key, 0);
  const supervisor = prior.events.find(value => value.source === 'agent')!;
  const closure = await e.journal.closeOutputDelivery(e.receipt);
  const { seq, ...event } = supervisor; void seq;
  expect(await e.journal.appendSupervisor({ sourceOrdinal: 1, event })).toEqual(supervisor);
  await e.journal.durableCancel(e.key);
  await e.journal.acknowledge({ protocolVersion: '1.0', ...e.key, throughSeq: closure.finalAgentSeq });
  expect((await e.journal.prune(e.key)).pruned).toBe(prior.events.length);
  expect((await e.journal.get(e.key)).lastSeq).toBe(closure.finalAgentSeq);
  expect(await e.journal.readOutputDelivery(e.key)).toEqual(closure);
});
it.each(['sequence', 'source', 'charge', 'marker', 'missing', 'oversized'] as const)('refuses persisted %s contradictions through bounded native read validation', async kind => {
  const e = await f.nativeReady(); e.delivery({ kind: 'outputDeliveryClose', json: json(e.receipt) }); f.closeNative(e.db);
  const broken = f.corruptCopy(e.path);
  const changes = {
    sequence: 'UPDATE accepted_attempts SET last_seq=last_seq+1',
    source: "UPDATE output_delivery_closures SET closure_json=json_set(closure_json,'$.receipt.sourceDigest','' || printf('%064d',0))",
    charge: 'UPDATE accepted_attempts SET delivery_bytes=delivery_bytes-1',
    marker: 'UPDATE accepted_attempts SET delivery_pending=1',
    missing: 'DELETE FROM output_delivery_closures',
    oversized: "UPDATE output_delivery_closures SET closure_json='\"' || printf('%02000d',0) || '\"'",
  };
  broken.exec(changes[kind]);
  expect(() => new Store(broken).execute({ kind: 'outputDeliveryRead', key: e.key, id: 1 }))
    .toThrow(expect.objectContaining({ code: 'unavailable' }));
});
