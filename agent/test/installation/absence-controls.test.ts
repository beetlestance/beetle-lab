import { expect, it, vi } from 'vitest';
import { fixture, operation, scope } from './fixtures.js';
import { entries, managers, trapped, writeResult } from './delivery-fixtures.js';
import { sourceFixture } from '../source-journal/fixtures.js';
const f = fixture(); const sources = sourceFixture(); const create = managers();

it('unknown launch and exited observation retain the execution charge and cannot reach absence close', async () => {
  const e = await f.setup(); e.backend.startResult = { outcome: 'unknown', reason: 'unavailable' };
  const manager = create(e.options); await e.accepted(manager); const close = vi.spyOn(e.owner, 'closeOutputAbsence');
  await manager.drive(scope(e.offer), operation()); e.backend.observation = e.backend.known('exited').value;
  for (let index = 0; index < 4; index++) { e.time.advance(1); await manager.drive(scope(e.offer), operation()); }
  expect((await manager.inspect(scope(e.offer))).allocation).toMatchObject({ status: 'charged', launchSettlement: { disposition: 'unknown' } });
  expect(await e.owner.readOutputAbsence(scope(e.offer))).toBeNull(); expect(close).not.toHaveBeenCalled();
  expect(entries(manager).size).toBe(1); expect(e.backend.starts).toBe(1);
});

it('local installed identity exceptions preserve inherited charged facts without manufacturing a durable rejection', async () => {
  const e = await f.setup(); await f.enqueue(e.owner, e.offer); await f.admit(e.owner, e.offer);
  const before = await e.owner.get(scope(e.offer)); const charge = await e.owner.admission({ kind: 'reservation', key: scope(e.offer) });
  const close = vi.spyOn(e.owner, 'closeOutputAbsence');
  const manager = create({ ...e.options, catalog: { ...e.catalog, resolve() { throw new Error('synthetic local catalogue drift'); } } });
  expect(await manager.drive(scope(e.offer), operation())).toEqual({ kind: 'rejected', reason: 'installed_identity' });
  expect(await e.owner.get(scope(e.offer))).toEqual(before); expect(await e.owner.admission({ kind: 'reservation', key: scope(e.offer) })).toEqual(charge);
  expect(await e.owner.readOutputAbsence(scope(e.offer))).toBeNull(); expect(close).not.toHaveBeenCalled(); expect(entries(manager).size).toBe(1);
  await manager.close(); expect(await e.owner.get(scope(e.offer))).toEqual(before); expect(close).not.toHaveBeenCalled();
});

it('ordinary queued catalogue refusals reclaim more than 64 idle owners without creating durable absence facts', async () => {
  const e = await f.setup(); let drift = false;
  const catalog = { ...e.catalog, preflight(input: unknown) {
    if (drift) throw new Error('synthetic local pin change');
    return e.catalog.preflight(input);
  } };
  const manager = create({ ...e.options, catalog }); const close = vi.spyOn(e.owner, 'closeOutputAbsence');
  for (let index = 1; index <= 66; index++) {
    const offer = { ...e.offer, attemptId: f.job(index).attemptId }; drift = false; await e.accepted(manager, offer); drift = true;
    expect(await manager.drive(scope(offer), operation())).toEqual({ kind: 'rejected', reason: 'installed_identity' });
    expect((await e.owner.get(scope(offer))).admission).toEqual({ state: 'queued' }); expect(entries(manager).size).toBe(0);
  }
  expect(close).not.toHaveBeenCalled(); expect(e.backend.starts).toBe(0);
});

it('recovered pending publication remains charged and cannot be relabelled failed collection or source absence', async () => {
  const e = await sources.seed(); await e.journal.beginOutputCollection(e.intent);
  const options = trapped(e.journal); const manager = create(options); const close = vi.spyOn(e.journal, 'closeOutputAbsence');
  await expect(manager.drive(e.key, operation())).rejects.toMatchObject({ reason: 'catalog' });
  expect(await e.journal.readOutputCollection(e.key)).toEqual(e.intent);
  expect((await e.journal.get(e.key)).admission).toEqual({ state: 'charged' });
  expect(await e.journal.readOutputAbsence(e.key)).toBeNull(); expect(close).not.toHaveBeenCalled(); expect(entries(manager).size).toBe(1);
  await expect(manager.close()).rejects.toMatchObject({ reason: 'cleanup' });
});

it('real staged source publication keeps exact source release/delivery and never invokes absence close during late cancellation', async () => {
  const e = await f.setup(4000); const manager = create(e.options); await e.accepted(manager);
  await manager.drive(scope(e.offer), operation()); await writeResult(e, manager);
  const close = vi.spyOn(e.owner, 'closeOutputAbsence'); e.backend.observation = e.backend.known('exited').value;
  expect(await e.finish(manager)).toEqual({ kind: 'released', collection: 'finished' });
  const source = await e.owner.readOutputSource(scope(e.offer)); const delivery = await e.owner.readOutputDelivery(scope(e.offer));
  expect(source).not.toBeNull(); expect(delivery?.receipt.key).toEqual(scope(e.offer));
  await manager.cancel(scope(e.offer)); await manager.cancelOriginal(e.offer); await manager.stop(scope(e.offer), 'timeout');
  expect(await e.owner.readOutputSource(scope(e.offer))).toEqual(source); expect(await e.owner.readOutputDelivery(scope(e.offer))).toEqual(delivery);
  expect(await e.owner.readOutputAbsence(scope(e.offer))).toBeNull(); expect(close).not.toHaveBeenCalled(); expect(entries(manager).size).toBe(0);
});
