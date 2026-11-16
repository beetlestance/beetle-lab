import { expect, it, vi } from 'vitest';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { JournalError } from '../../src/journal/index.js';
import { fixture, operation, scope } from './fixtures.js';
import { deferred, entries, managers, writeResult } from './delivery-fixtures.js';
const f = fixture(); const create = managers();

it('actual Manager excludes only its calling drive and drains earlier public lease, real watch descriptors, final cancellation and controller close before closure', async () => {
  const e = await f.setup(4000); const watchGate = deferred<void>(); const cancelGate = deferred<void>(); const controllerGate = deferred<void>();
  const watchFd = await open(join(e.rootPath, 'owned-watch'), 'w'); const cancelFd = await open(join(e.rootPath, 'owned-cancellation'), 'w');
  const watchClose = vi.fn(async () => { await watchGate.promise; await watchFd.close(); });
  const manager = create({ ...e.options, guard: { watch: () => ({ initial: Promise.resolve({ ready: true }),
    status: () => ({ ready: true, closed: false, stopRequested: false, lastKnownAt: 0 }), close: watchClose }) } });
  await e.accepted(manager); await manager.drive(scope(e.offer), operation()); await writeResult(e, manager);
  const entry = [...entries(manager).values()][0]!; const controller = entry.controller!;
  const closeOriginal = controller.close.bind(controller);
  const close = vi.spyOn(controller, 'close').mockImplementation(async () => { await controllerGate.promise; await closeOriginal(); });
  const cancelOriginal = controller.cancel.bind(controller);
  vi.spyOn(controller, 'cancel').mockImplementation(async reason => { await cancelOriginal(reason); await cancelGate.promise; await cancelFd.close(); });
  const sourceRead = e.owner.readOutputSource.bind(e.owner); const entered = deferred<void>(); const prior = deferred<void>();
  const source = vi.spyOn(e.owner, 'readOutputSource').mockImplementationOnce(async key => {
    const original = await sourceRead(key); expect(original).toBeNull(); entered.resolve(); await prior.promise; return original;
  });
  const cancelling = manager.stop(scope(e.offer), 'output_limit'); await entered.promise;
  expect(entry.leases.size).toBe(1);
  e.backend.observation = e.backend.known('exited').value;
  const drive = (async () => {
    for (let index = 0; index < 12; index++) {
      e.time.advance(1); const progress = await manager.drive(scope(e.offer), operation());
      if (progress.kind === 'released') return progress;
    }
    throw new Error('source did not release');
  })();
  const delivery = vi.spyOn(e.owner, 'closeOutputDelivery');
  try {
    await vi.waitFor(() => expect(entry.retiring).toBe(true)); expect(entry.leases.size).toBe(2);
    expect(watchClose).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled(); expect(delivery).not.toHaveBeenCalled();
    await expect(manager.cancel(scope(e.offer))).rejects.toMatchObject({ reason: 'busy' });
    await expect(manager.cancelOriginal(e.offer)).rejects.toMatchObject({ reason: 'busy' });
    await expect(manager.drive(scope(e.offer), operation())).rejects.toMatchObject({ reason: 'busy' });
    prior.resolve(); await cancelling;
    await vi.waitFor(() => expect(watchClose).toHaveBeenCalledTimes(1)); expect(entry.leases.size).toBe(1);
    expect(delivery).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled(); expect(watchFd.fd).toBeGreaterThanOrEqual(0);
    watchGate.resolve(); await vi.waitFor(() => expect(watchFd.fd).toBe(-1));
    expect(close).not.toHaveBeenCalled(); expect(delivery).not.toHaveBeenCalled(); expect(cancelFd.fd).toBeGreaterThanOrEqual(0);
    cancelGate.resolve(); await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1)); expect(cancelFd.fd).toBe(-1);
    expect(e.manager.size).toBe(1); expect(delivery).not.toHaveBeenCalled();
    controllerGate.resolve(); expect(await drive).toEqual({ kind: 'released', collection: 'finished' });
    expect(e.manager.size).toBe(0); expect(entries(manager).size).toBe(0); expect(delivery).toHaveBeenCalledTimes(1);
    expect((await e.owner.readOutputDelivery(scope(e.offer)))?.receipt).toEqual(entry.sourceReceipt);
  } finally {
    prior.resolve(); watchGate.resolve(); cancelGate.resolve(); controllerGate.resolve(); source.mockRestore();
    await Promise.allSettled([drive, cancelling]); await Promise.allSettled([watchFd.close(), cancelFd.close()]);
  }
});
it('unknown source after durable cancellation retains the owner and never authorizes native signalling', async () => {
  const e = await f.setup(); const manager = create(e.options); await e.accepted(manager); await manager.drive(scope(e.offer), operation());
  const entry = [...entries(manager).values()][0]!; const cancel = vi.spyOn(entry.controller!, 'cancel');
  const source = vi.spyOn(e.owner, 'readOutputSource').mockRejectedValueOnce(new JournalError('unavailable'));
  await expect(manager.cancel(scope(e.offer))).rejects.toMatchObject({ code: 'unavailable' });
  expect(cancel).not.toHaveBeenCalled(); expect(entry.sourceCheck).toBe(true); expect(entries(manager).size).toBe(1);
  expect((await e.owner.get(scope(e.offer))).cancelRequested).toBe(true); source.mockRestore();
  await e.finish(manager); expect(cancel).toHaveBeenCalled();
});
it('global shutdown holds a prior cancellation lease and its late assigned chain before original controller close', async () => {
  const e = await f.setup(); const manager = create(e.options); await e.accepted(manager); await manager.drive(scope(e.offer), operation());
  const entry = [...entries(manager).values()][0]!; const gate = deferred<void>(); const started = deferred<void>(); const stopGate = deferred<void>();
  const read = e.owner.readOutputSource.bind(e.owner);
  vi.spyOn(e.owner, 'readOutputSource').mockImplementationOnce(async key => { const value = await read(key); started.resolve(); await gate.promise; return value; });
  const cancel = entry.controller!.cancel.bind(entry.controller!);
  vi.spyOn(entry.controller!, 'cancel').mockImplementation(async reason => { await cancel(reason); await stopGate.promise; });
  const close = vi.spyOn(entry.controller!, 'close'); const cancelling = manager.cancel(scope(e.offer)); await started.promise;
  let settled = false; const closing = manager.close().then(() => { settled = true; });
  try {
    await new Promise<void>(resolve => setImmediate(resolve)); expect(settled).toBe(false); expect(close).not.toHaveBeenCalled();
    gate.resolve(); await cancelling; await new Promise<void>(resolve => setImmediate(resolve));
    expect(settled).toBe(false); expect(close).not.toHaveBeenCalled(); stopGate.resolve(); await closing;
    expect(close).toHaveBeenCalledTimes(1); expect(e.manager.size).toBe(0);
  } finally { gate.resolve(); stopGate.resolve(); await Promise.allSettled([cancelling, closing]); }
});
