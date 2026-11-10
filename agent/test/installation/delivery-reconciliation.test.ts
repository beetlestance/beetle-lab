import { DatabaseSync } from 'node:sqlite';
import { open } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import { encodeCanonicalJson } from '@beetle/contracts';
import { JournalError } from '../../src/journal/index.js';
import { receiptForOutputSource } from '../../src/output-source/index.js';
import { createEntry, identity } from '../../src/installation/entry.js';
import { sourceFixture, hash } from '../source-journal/fixtures.js';
import { operation } from './fixtures.js';
import { entries, managers, trapped, withheld } from './delivery-fixtures.js';
const f = sourceFixture(); const create = managers();
async function seed() {
  const e = await f.seed(); await e.journal.beginOutputCollection(e.intent);
  const receipt = await e.journal.commitOutputSource(e.collected); await e.journal.releaseOutputSource(receipt);
  return { ...e, receipt };
}
function native(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try { return { parent: db.prepare('SELECT * FROM accepted_attempts').get(), closure: db.prepare('SELECT * FROM output_delivery_closures').all(),
    source: db.prepare('SELECT * FROM output_sources').all(), holds: db.prepare('SELECT * FROM disk_holds').all(),
    counters: db.prepare('SELECT * FROM disk_retention_stats').all(), fks: db.prepare('PRAGMA foreign_key_check').all() }; }
  finally { db.close(); }
}

it('same Manager retains native completion across real quota denial and retries only closure after actual ACK/prune', async () => {
  const e = await seed(); const last = (await e.journal.get(e.key)).lastSeq; await f.close(e.journal);
  const db = new DatabaseSync(e.path); const charge = Buffer.byteLength(encodeCanonicalJson({ version: 1, receipt: e.receipt, finalAgentSeq: last }, 1024)) + 256;
  try {
    const used = Number(db.prepare('SELECT spool_bytes+snapshot_bytes+checkpoint_bytes+hold_bytes+collection_bytes+source_bytes+delivery_bytes AS n FROM accepted_attempts').get()?.n);
    db.prepare('UPDATE accepted_attempts SET quota_bytes=?').run(used + charge - 1);
  } finally { db.close(); }
  const journal = await f.open(e.path); const options = trapped(journal); const manager = create(options);
  await expect(manager.drive(e.key, operation())).rejects.toMatchObject({ code: 'quota_exceeded' });
  const owner = [...entries(manager).values()][0]!; const nativeCompletion = owner.nativeRetirement;
  expect(owner.retiring).toBe(true); expect(owner.leases.size).toBe(0);
  await expect(manager.cancel(e.key)).rejects.toMatchObject({ reason: 'busy' });
  await expect(manager.cancelOriginal(e.offer)).rejects.toMatchObject({ reason: 'busy' });
  await journal.acknowledge({ protocolVersion: '1.0', ...e.key, throughSeq: last }); await journal.prune(e.key);
  expect(await manager.drive(e.key, operation())).toEqual({ kind: 'released', collection: 'finished' });
  expect(owner.nativeRetirement).toBe(nativeCompletion); expect(entries(manager).size).toBe(0); expect(options.trap).not.toHaveBeenCalled();
  const closure = await journal.readOutputDelivery(e.key); expect(closure?.receipt).toEqual(e.receipt);
  await manager.close(); await f.close(journal); const facts = native(e.path);
  expect(facts.parent).toMatchObject({ delivery_bytes: charge, delivery_pending: 0, spool_bytes: 0 });
  expect(facts.closure).toHaveLength(1); expect(facts.holds[0]?.phase).toBe('retained'); expect(facts.fks).toEqual([]);
});
it('settled ambiguous reply reconciles the actual stored closure in the same Manager without retrying native closes or close request', async () => {
  const e = await seed(); const options = trapped(e.journal); const manager = create(options);
  const close = e.journal.closeOutputDelivery.bind(e.journal);
  const spy = vi.spyOn(e.journal, 'closeOutputDelivery').mockImplementationOnce(async receipt => { await close(receipt); throw new JournalError('unavailable'); });
  await expect(manager.drive(e.key, operation())).rejects.toMatchObject({ code: 'unavailable' });
  const owner = [...entries(manager).values()][0]!; const retired = owner.nativeRetirement;
  expect(owner.retiring).toBe(true); expect((await e.journal.readOutputDelivery(e.key))?.receipt).toEqual(e.receipt);
  expect(await manager.drive(e.key, operation())).toEqual({ kind: 'released', collection: 'finished' });
  expect(owner.nativeRetirement).toBe(retired); expect(spy).toHaveBeenCalledTimes(1); expect(entries(manager).size).toBe(0);
  expect(options.trap).not.toHaveBeenCalled(); await manager.close();
});
it('genuinely withheld COMMIT reply keeps original drive, producer fence and global shutdown pending until the exact reply arrives', async () => {
  const e = await seed(); const options = trapped(e.journal); const manager = create(options); const hold = withheld(e.journal);
  const driving = manager.drive(e.key, operation()); await hold.observed;
  const owner = [...entries(manager).values()][0]!; expect(owner.retiring).toBe(true); expect(owner.leases.size).toBe(1);
  await expect(manager.cancel(e.key)).rejects.toMatchObject({ reason: 'busy' });
  await expect(manager.stop(e.key, 'timeout')).rejects.toMatchObject({ reason: 'busy' });
  await expect(manager.drive(e.key, operation())).rejects.toMatchObject({ reason: 'busy' });
  expect((await e.journal.readOutputDelivery(e.key))?.receipt).toEqual(e.receipt);
  let closed = false; const closing = manager.close().then(() => { closed = true; });
  try {
    await new Promise<void>(resolve => setImmediate(resolve)); expect(closed).toBe(false); expect(entries(manager).size).toBe(1);
    hold.deliver(); expect(await driving).toEqual({ kind: 'released', collection: 'finished' }); await closing;
    expect(closed).toBe(true); expect(entries(manager).size).toBe(0); expect(options.trap).not.toHaveBeenCalled();
  } finally { hold.deliver(); await Promise.allSettled([driving, closing]); }
});
it('withheld real reply plus Journal abort retains the old fence; recreated owner reads the same committed closure after reopen', async () => {
  const e = await seed(); const options = trapped(e.journal); const manager = create(options); const hold = withheld(e.journal);
  const driving = manager.drive(e.key, operation()); const rejected = expect(driving).rejects.toMatchObject({ code: 'unavailable' });
  await hold.observed; await e.journal.abort(); await rejected;
  expect([...entries(manager).values()][0]?.retiring).toBe(true); await expect(manager.close()).rejects.toMatchObject({ reason: 'cleanup' });
  const before = native(e.path); const journal = await f.open(e.path); const nextOptions = trapped(journal); const next = create(nextOptions);
  const close = vi.spyOn(journal, 'closeOutputDelivery');
  expect(await next.drive(e.key, operation())).toEqual({ kind: 'released', collection: 'finished' });
  expect(close).not.toHaveBeenCalled(); expect(nextOptions.trap).not.toHaveBeenCalled(); await next.close(); await f.close(journal);
  expect(native(e.path)).toEqual(before); expect(before.closure).toHaveLength(1); expect(before.fks).toEqual([]);
});
it.each(['receipt', 'shape'] as const)('refuses mismatched actual stored %s reply and retains the owner until exact reconciliation', async kind => {
  const e = await seed(); await e.journal.closeOutputDelivery(e.receipt); const options = trapped(e.journal); const manager = create(options);
  const read = e.journal.readOutputDelivery.bind(e.journal);
  const spy = vi.spyOn(e.journal, 'readOutputDelivery').mockImplementationOnce(async key => {
    const actual = structuredClone(await read(key)); if (!actual) throw new Error('Missing real closure');
    if (kind === 'receipt') Reflect.set(actual.receipt, 'sourceDigest', '0'.repeat(64)); else Reflect.set(actual, 'extra', true);
    return actual;
  });
  await expect(manager.drive(e.key, operation())).rejects.toMatchObject({ reason: 'journal' });
  expect([...entries(manager).values()][0]?.retiring).toBe(true); spy.mockRestore();
  expect(await manager.drive(e.key, operation())).toEqual({ kind: 'released', collection: 'finished' });
  expect(options.trap).not.toHaveBeenCalled(); await manager.close();
});
it('late cancel, stop and canonical cancelOriginal around a committed closed source perform metadata only and never advance the stream', async () => {
  const e = await seed(); const options = trapped(e.journal); const manager = create(options);
  expect(await manager.drive(e.key, operation())).toEqual({ kind: 'released', collection: 'finished' });
  const closure = await e.journal.readOutputDelivery(e.key); const cursors = await e.journal.sourceCursors(e.key);
  for (const cancel of [() => manager.cancel(e.key), () => manager.stop(e.key, 'timeout'), () => manager.cancelOriginal(e.offer)]) {
    expect((await cancel()).cancelRequested).toBe(true);
    expect(entries(manager).size).toBe(0);
  }
  await expect(manager.cancelOriginal({ ...e.offer, intentDigest: '0'.repeat(64) })).rejects.toMatchObject({ code: 'conflict' });
  expect((await e.journal.get(e.key)).lastSeq).toBe(closure!.finalAgentSeq);
  expect(await e.journal.sourceCursors(e.key)).toEqual(cursors); expect(await e.journal.readOutputDelivery(e.key)).toEqual(closure);
  expect(options.trap).not.toHaveBeenCalled(); expect(receiptForOutputSource(e.source, hash)).toEqual(closure!.receipt); await manager.close();
});
it('a rejected original native watch close stays cached and fenced independently of metadata reconciliation', async () => {
  const e = await seed(); const options = trapped(e.journal); const manager = create(options);
  const handle = await open(f.path() + '.watch', 'w'); const watchClose = vi.fn(async () => { throw new Error('synthetic uncertain descriptor close'); });
  const entry = createEntry(e.key); entry.watch = { initial: Promise.resolve({ ready: true }),
    status: () => ({ ready: true, closed: false, stopRequested: false, lastKnownAt: 0 }), close: watchClose };
  entries(manager).set(identity(e.key), entry); const closure = vi.spyOn(e.journal, 'closeOutputDelivery');
  try {
    await expect(manager.drive(e.key, operation())).rejects.toMatchObject({ reason: 'cleanup' });
    const original = entry.nativeRetirement; expect(entry.retiring).toBe(true); expect(entry.cleanupFailed).toBe(true);
    await expect(manager.drive(e.key, operation())).rejects.toMatchObject({ reason: 'cleanup' });
    expect(entry.nativeRetirement).toBe(original); expect(watchClose).toHaveBeenCalledTimes(1); expect(closure).not.toHaveBeenCalled();
    expect(entries(manager).size).toBe(1); expect(handle.fd).toBeGreaterThanOrEqual(0);
    await expect(manager.close()).rejects.toMatchObject({ reason: 'cleanup' }); expect(watchClose).toHaveBeenCalledTimes(1);
  } finally { await handle.close(); }
});
