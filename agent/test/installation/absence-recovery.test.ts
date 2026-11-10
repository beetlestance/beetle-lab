import { expect, it, vi } from 'vitest';
import { JournalError } from '../../src/journal/index.js';
import { controlled } from '../supervisor/fixtures.js';
import { fixture, operation, scope, deferred } from './fixtures.js';
import { entries, managers } from './delivery-fixtures.js';
import { withheldAbsence } from './absence-fixtures.js';
const f = fixture(); const create = managers();

async function releasedDebt() {
  const e = await f.setup(); const manager = create(e.options); await e.accepted(manager);
  const close = vi.spyOn(e.owner, 'closeOutputAbsence').mockRejectedValue(new JournalError('queue_full'));
  await expect(e.finish(manager)).rejects.toMatchObject({ code: 'queue_full' });
  expect((await e.owner.get(scope(e.offer))).admission).toEqual({ state: 'released', disposition: 'settled' });
  expect(await e.owner.readOutputAbsence(scope(e.offer))).toBeNull();
  await expect(manager.close()).rejects.toMatchObject({ reason: 'cleanup' });
  await f.close(e.owner); close.mockRestore();
  const journal = await f.open(e.journalPath); const owner = controlled(journal);
  owner.backend.observation = e.backend.known('exited').value;
  const next = create({ ...e.options, journal, supervisor: owner.manager });
  return { ...e, journal, next, native: owner, key: scope(e.offer) };
}

it('replays indexed cold rejection without catalogue/staging and clears debt only after the owned barrier closes', async () => {
  const e = await f.setup(); const key = scope(e.offer);
  await e.owner.cancelOriginal({ offer: e.offer, now: e.time.wall() }); await f.close(e.owner);
  const journal = await f.open(e.journalPath); const trap = vi.fn((): never => { throw new Error('unexpected native launch or catalogue'); });
  const manager = create({ ...e.options, journal, catalog: { engines: [], preflight: trap, resolve: trap }, stagerFor: trap });
  expect((await journal.scanRunnable({ lane: 'delivery', limit: 1 })).attempts).toEqual([key]);
  expect(await manager.drive(key, operation())).toEqual({ kind: 'rejected', reason: 'cancelled' });
  expect(await journal.readOutputAbsence(key)).toMatchObject({ admission: { state: 'rejected', reason: 'cancelled' }, finalAgentSeq: 0 });
  expect((await journal.scanRunnable({ lane: 'delivery', limit: 1 })).attempts).toEqual([]);
  expect(trap).not.toHaveBeenCalled(); expect(entries(manager).size).toBe(0);
});

it('actual admission rejection in drive retires and commits absence before reporting rejected progress', async () => {
  const e = await f.setup(); const manager = create(e.options); await e.accepted(manager);
  await e.owner.admission({ kind: 'configure', configuration: { ...(await import('../admission/fixtures.js')).configuration(), maxTimeoutMs: 1 } });
  const progress = await manager.drive(scope(e.offer), operation());
  expect(progress.kind).toBe('rejected');
  expect(await e.owner.readOutputAbsence(scope(e.offer))).toMatchObject({ admission: { state: 'rejected' } });
  expect(e.backend.starts).toBe(0); expect(entries(manager).size).toBe(0);
});

it.each(['exited', 'created', 'missing'] as const)('cold settled debt establishes actual readonly %s native retirement before closure without late facts', async state => {
  const e = await releasedDebt();
  e.native.backend.observation = state === 'missing' ? { state: 'missing' } : e.native.backend.known(state).value;
  const before = await e.journal.get(e.key); const cursors = await e.journal.sourceCursors(e.key);
  const clock = await e.journal.supervision({ key: e.key, now: e.time.wall() });
  const inspect = vi.spyOn(e.native.backend, 'inspect');
  const writes = vi.spyOn(e.journal, 'appendSupervisor'); const supervision = vi.spyOn(e.journal, 'supervision');
  const admission = vi.spyOn(e.journal, 'admission'); const close = vi.spyOn(e.journal, 'closeOutputAbsence');
  expect((await e.journal.scanRunnable({ lane: 'delivery', limit: 1 })).attempts).toEqual([e.key]);
  expect(await e.next.drive(e.key, operation())).toEqual({ kind: 'released', collection: 'failed' });
  expect(inspect).toHaveBeenCalledTimes(1); expect(close).toHaveBeenCalledExactlyOnceWith(e.key);
  expect(writes).not.toHaveBeenCalled(); expect(supervision).not.toHaveBeenCalled();
  expect(admission.mock.calls.every(([command]) => command.kind === 'reservation')).toBe(true);
  expect(await e.journal.get(e.key)).toEqual(before); expect(await e.journal.sourceCursors(e.key)).toEqual(cursors);
  expect(await e.journal.supervision({ key: e.key, now: e.time.wall() })).toEqual(clock);
  expect(e.native.backend.creates).toBe(0); expect(e.native.backend.starts).toBe(0);
  expect(e.native.backend.stops).toEqual([]); expect(e.native.backend.kills).toBe(0); expect(e.native.manager.size).toBe(0);
  expect((await e.journal.readOutputAbsence(e.key))?.finalAgentSeq).toBe(before.lastSeq);
  expect((await e.journal.scanRunnable({ lane: 'delivery', limit: 1 })).attempts).toEqual([]);
});

it.each(['running', 'unknown', 'wrong_id', 'restarting'] as const)('cold %s inspection retains fenced owner and debt until a known readonly retry', async state => {
  const e = await releasedDebt();
  if (state === 'wrong_id') e.native.backend.observation = { ...e.native.backend.known('exited').value, id: 'f'.repeat(64) };
  else e.native.backend.observation = e.native.backend.known(state === 'unknown' ? 'unknown' : state).value;
  const close = vi.spyOn(e.journal, 'closeOutputAbsence'); const inspect = vi.spyOn(e.native.backend, 'inspect');
  const before = await e.journal.get(e.key);
  await expect(e.next.drive(e.key, operation())).rejects.toMatchObject({ code: 'backend_unavailable' });
  expect(close).not.toHaveBeenCalled(); expect(e.native.manager.size).toBe(1); expect(entries(e.next).size).toBe(1);
  expect(await e.journal.readOutputAbsence(e.key)).toBeNull(); expect(await e.journal.get(e.key)).toEqual(before);
  expect((await e.journal.scanRunnable({ lane: 'delivery', limit: 1 })).attempts).toEqual([e.key]);
  e.native.backend.observation = e.native.backend.known('exited').value;
  expect(await e.next.drive(e.key, operation())).toEqual({ kind: 'released', collection: 'failed' });
  expect(inspect).toHaveBeenCalledTimes(2); expect(close).toHaveBeenCalledTimes(1); expect(e.native.manager.size).toBe(0);
});

it('held original cold inspection keeps the drive and shutdown pending, then closes without another inspection', async () => {
  const e = await releasedDebt(); const gate = deferred<void>(); const entered = deferred<void>();
  const inspect = e.native.backend.inspect.bind(e.native.backend);
  const native = vi.spyOn(e.native.backend, 'inspect').mockImplementation(async (...args) => { entered.resolve(); await gate.promise; return inspect(...args); });
  const absence = vi.spyOn(e.journal, 'closeOutputAbsence');
  const driving = e.next.drive(e.key, operation()); await entered.promise;
  let closed = false; const closing = e.next.close().then(() => { closed = true; });
  try {
    await new Promise<void>(resolve => setImmediate(resolve)); expect(closed).toBe(false);
    expect(absence).not.toHaveBeenCalled(); expect(entries(e.next).size).toBe(1); expect(e.native.manager.size).toBe(1);
    expect(() => e.native.manager.retire({ key: e.key, plan: native.mock.calls[0]![0] })).toThrow('Supervisor conflict');
    gate.resolve(); expect(await driving).toEqual({ kind: 'released', collection: 'failed' }); await closing;
    expect(native).toHaveBeenCalledTimes(1); expect(absence).toHaveBeenCalledTimes(1); expect(closed).toBe(true);
  } finally { gate.resolve(); await Promise.allSettled([driving, closing]); }
});

it('metadata reply loss reuses actual native completion and reconciles committed proof without issuing another close', async () => {
  const e = await f.setup(); const manager = create(e.options); await e.accepted(manager);
  const close = e.owner.closeOutputAbsence.bind(e.owner);
  const attempt = vi.spyOn(e.owner, 'closeOutputAbsence').mockImplementationOnce(async key => { await close(key); throw new JournalError('unavailable'); });
  await expect(e.finish(manager)).rejects.toMatchObject({ code: 'unavailable' });
  const entry = [...entries(manager).values()][0]!; const original = entry.nativeRetirement;
  const proof = await e.owner.readOutputAbsence(entry.key); expect(proof).not.toBeNull();
  expect(await manager.drive(entry.key, operation())).toEqual({ kind: 'released', collection: 'failed' });
  expect(entry.nativeRetirement).toBe(original); expect(attempt).toHaveBeenCalledTimes(1); expect(entries(manager).size).toBe(0);
});

it('withheld actual commit reply keeps owned drive until abort and cold reopen reads the committed proof without an empty-owner inference', async () => {
  const e = await f.setup(); const manager = create(e.options); await e.accepted(manager); const hold = withheldAbsence(e.owner);
  const driving = e.finish(manager); const failed = expect(driving).rejects.toMatchObject({ code: 'unavailable' });
  await hold.observed; expect(entries(manager).size).toBe(1);
  const proof = await e.owner.readOutputAbsence(scope(e.offer)); expect(proof).not.toBeNull();
  await e.owner.abort(); await failed; await expect(manager.close()).rejects.toMatchObject({ reason: 'cleanup' });
  const journal = await f.open(e.journalPath); const native = controlled(journal); const inspect = vi.spyOn(native.backend, 'inspect');
  const next = create({ ...e.options, journal, supervisor: native.manager }); const close = vi.spyOn(journal, 'closeOutputAbsence');
  expect((await journal.scanRunnable({ lane: 'delivery', limit: 1 })).attempts).toEqual([]);
  expect(await next.drive(scope(e.offer), operation())).toEqual({ kind: 'released', collection: 'failed' });
  expect(await journal.readOutputAbsence(scope(e.offer))).toEqual(proof); expect(close).not.toHaveBeenCalled(); expect(inspect).not.toHaveBeenCalled();
});
