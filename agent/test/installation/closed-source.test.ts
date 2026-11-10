import { expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { JournalError } from '../../src/journal/index.js';
import { operation } from './fixtures.js';
import { sourceFixture } from '../source-journal/fixtures.js';
import { deferred, entries, managers, trapped } from './delivery-fixtures.js';
import { closedHistory, historyCapacity } from './closed-source-fixtures.js';
const f = sourceFixture(); const create = managers();

it('late metadata calls retire more than 64 closed historical sources without any follow-up drive', async () => {
  const e = await f.seed(); await historyCapacity(e); const options = trapped(e.journal); const manager = create(options);
  const close = vi.spyOn(e.journal, 'closeOutputDelivery');
  for (let index = 2; index < 68; index++) {
    const h = await closedHistory(f, e, index); close.mockClear();
    const cursors = await e.journal.sourceCursors(h.key);
    const calls = [() => manager.cancel(h.key), () => manager.stop(h.key, 'timeout'), () => manager.cancelOriginal(h.offer)];
    expect((await calls[index % calls.length]!()).cancelRequested).toBe(true);
    expect(entries(manager).size).toBe(0);
    expect(await e.journal.readOutputDelivery(h.key)).toEqual(h.closure);
    expect((await e.journal.get(h.key)).lastSeq).toBe(h.closure.finalAgentSeq);
    expect(await e.journal.sourceCursors(h.key)).toEqual(cursors); expect(close).not.toHaveBeenCalled();
  }
  expect(options.trap).not.toHaveBeenCalled();
  await manager.close(); await f.close(e.journal);
  const db = new DatabaseSync(e.path, { readOnly: true });
  try {
    expect(db.prepare('SELECT count(*) AS n FROM output_delivery_closures').get()?.n).toBe(66);
    expect(db.prepare('SELECT count(*) AS n FROM accepted_attempts WHERE delivery_pending=1').get()?.n).toBe(0);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); }
});
it('late closed-source cleanup retains a concurrently held original and evicts only after its final lease', async () => {
  const e = await f.seed(); const h = await closedHistory(f, e, 2); const options = trapped(e.journal); const manager = create(options);
  const entered = deferred<void>(); const gate = deferred<void>(); const read = e.journal.readOutputSource.bind(e.journal);
  vi.spyOn(e.journal, 'readOutputSource').mockImplementationOnce(async key => { const source = await read(key); entered.resolve(); await gate.promise; return source; });
  const first = manager.cancel(h.key); await entered.promise;
  const owner = [...entries(manager).values()][0]!; const close = vi.spyOn(e.journal, 'closeOutputDelivery');
  try {
    await manager.stop(h.key, 'timeout'); expect(entries(manager).size).toBe(1);
    expect(owner.leases.size).toBe(1); expect(owner.retiring).toBe(false);
    gate.resolve(); await first;
    expect(entries(manager).size).toBe(0); expect(owner.leases.size).toBe(0);
    expect(await e.journal.readOutputDelivery(h.key)).toEqual(h.closure); expect(close).not.toHaveBeenCalled();
    expect(options.trap).not.toHaveBeenCalled();
  } finally { gate.resolve(); await Promise.allSettled([first]); }
});

it.each(['missing', 'unavailable', 'mismatch'] as const)('late source cleanup retains %s closure custody for exact reconciliation-only drive', async kind => {
  const e = await f.seed(); await e.journal.beginOutputCollection(e.intent);
  const receipt = await e.journal.commitOutputSource(e.collected); await e.journal.releaseOutputSource(receipt);
  if (kind !== 'missing') await e.journal.closeOutputDelivery(receipt);
  const options = trapped(e.journal); const manager = create(options); const close = vi.spyOn(e.journal, 'closeOutputDelivery');
  const read = e.journal.readOutputDelivery.bind(e.journal);
  if (kind === 'unavailable') vi.spyOn(e.journal, 'readOutputDelivery').mockRejectedValueOnce(new JournalError('unavailable'));
  if (kind === 'mismatch') vi.spyOn(e.journal, 'readOutputDelivery').mockImplementationOnce(async key => {
    const value = structuredClone(await read(key)); if (!value) throw new Error('Missing actual closure');
    Reflect.set(value.receipt, 'sourceDigest', '0'.repeat(64)); return value;
  });
  const cancel = manager.cancel(e.key);
  if (kind === 'missing') expect((await cancel).cancelRequested).toBe(true);
  else await expect(cancel).rejects.toMatchObject(kind === 'unavailable' ? { code: 'unavailable' } : { reason: 'journal' });
  const entry = [...entries(manager).values()][0]!;
  expect(entry.retiring).toBe(true); expect(entry.leases.size).toBe(0); expect(close).not.toHaveBeenCalled();
  await expect(manager.stop(e.key, 'timeout')).rejects.toMatchObject({ reason: 'busy' });
  const release = vi.spyOn(e.journal, 'releaseOutputSource');
  expect(await manager.drive(e.key, operation())).toEqual({ kind: 'released', collection: 'finished' });
  expect(release).toHaveBeenCalledExactlyOnceWith(receipt);
  expect(close).toHaveBeenCalledTimes(kind === 'missing' ? 1 : 0);
  expect(entries(manager).size).toBe(0); expect((await read(e.key))?.receipt).toEqual(receipt);
  expect(options.trap).not.toHaveBeenCalled();
});
