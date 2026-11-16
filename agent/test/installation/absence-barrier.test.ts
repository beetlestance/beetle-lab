import { expect, it, vi } from 'vitest';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import type { RuntimePlan } from '../../src/backends/docker/index.js';
import type { StagingResult } from '../../src/staging/index.js';
import { fixture, operation, scope, deferred } from './fixtures.js';
import { entries, managers } from './delivery-fixtures.js';
import { createEntry, identity } from '../../src/installation/entry.js';
const f = fixture(); const create = managers();

it('failed collection closes only after actual public lease, watch, timeout, final cancellation and controller originals settle', async () => {
  const e = await f.setup(); const watchGate = deferred<void>(); const timeoutGate = deferred<void>();
  const cancelGate = deferred<void>(); const controllerGate = deferred<void>();
  const descriptor = await open(join(e.rootPath, 'absence-watch'), 'w');
  const watchClose = vi.fn(async () => { await watchGate.promise; await descriptor.close(); });
  const timeoutClose = vi.fn(async () => { await timeoutGate.promise; });
  const manager = create({ ...e.options,
    guard: { watch: () => ({ initial: Promise.resolve({ ready: true }),
      status: () => ({ ready: true, closed: false, stopRequested: false, lastKnownAt: 0 }), close: watchClose }) },
    timeout: { watch: () => ({ status: () => ({ ready: true, closed: false, stopRequested: false, reason: null }), close: timeoutClose }) } });
  await e.accepted(manager); await manager.drive(scope(e.offer), operation());
  const entry = [...entries(manager).values()][0]!; const controller = entry.controller!;
  const closeOriginal = controller.close.bind(controller);
  const controllerClose = vi.spyOn(controller, 'close').mockImplementation(async () => { await controllerGate.promise; await closeOriginal(); });
  const cancelOriginal = controller.cancel.bind(controller);
  vi.spyOn(controller, 'cancel').mockImplementation(async reason => { await cancelOriginal(reason); await cancelGate.promise; });
  const sourceRead = e.owner.readOutputSource.bind(e.owner); const entered = deferred<void>(); const prior = deferred<void>();
  vi.spyOn(e.owner, 'readOutputSource').mockImplementationOnce(async key => {
    const result = await sourceRead(key); entered.resolve(); await prior.promise; return result;
  });
  const cancelling = manager.stop(scope(e.offer), 'output_limit'); await entered.promise;
  e.backend.observation = e.backend.known('exited').value;
  const close = vi.spyOn(e.owner, 'closeOutputAbsence'); const driving = e.finish(manager);
  try {
    await vi.waitFor(() => expect(entry.retiring).toBe(true));
    expect(close).not.toHaveBeenCalled(); expect(watchClose).not.toHaveBeenCalled();
    expect(entry.leases.size).toBe(2);
    await expect(manager.cancel(scope(e.offer))).rejects.toMatchObject({ reason: 'busy' });
    prior.resolve(); await cancelling;
    await vi.waitFor(() => expect(watchClose).toHaveBeenCalledTimes(1));
    expect(timeoutClose).toHaveBeenCalledTimes(1); expect(descriptor.fd).toBeGreaterThanOrEqual(0);
    watchGate.resolve(); await vi.waitFor(() => expect(descriptor.fd).toBe(-1));
    expect(controllerClose).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
    timeoutGate.resolve(); await new Promise<void>(resolve => setImmediate(resolve));
    expect(controllerClose).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
    cancelGate.resolve(); await vi.waitFor(() => expect(controllerClose).toHaveBeenCalledTimes(1));
    expect(close).not.toHaveBeenCalled(); expect(e.manager.size).toBe(1);
    controllerGate.resolve(); expect(await driving).toEqual({ kind: 'released', collection: 'failed' });
    expect(e.manager.size).toBe(0); expect(entries(manager).size).toBe(0); expect(close).toHaveBeenCalledExactlyOnceWith(entry.key);
    const proof = await e.owner.readOutputAbsence(entry.key);
    expect(proof).toMatchObject({ reason: 'output_limit', admission: { state: 'released', disposition: 'settled' } });
    const seq = (await e.owner.get(entry.key)).lastSeq; expect(proof?.finalAgentSeq).toBe(seq);
    await manager.cancelOriginal(e.offer); await manager.stop(entry.key, 'timeout');
    expect((await e.owner.get(entry.key)).lastSeq).toBe(seq); expect(await e.owner.readOutputAbsence(entry.key)).toEqual(proof);
    await expect(e.owner.appendSupervisor({ sourceOrdinal: 99, event: { ...f.supervisor().event, ...entry.key } }))
      .rejects.toMatchObject({ code: 'unavailable' });
    await e.owner.abort(); const reopened = await f.open(e.journalPath);
    expect((await reopened.get(entry.key)).lastSeq).toBe(seq); expect(await reopened.readOutputAbsence(entry.key)).toEqual(proof);
  } finally {
    prior.resolve(); watchGate.resolve(); timeoutGate.resolve(); cancelGate.resolve(); controllerGate.resolve();
    await Promise.allSettled([driving, cancelling, descriptor.close()]);
  }
});

it('never-started closure waits original preparation result and quiescence and retains its charged reservation meanwhile', async () => {
  const e = await f.setup(); const entered = deferred<void>(); const result = deferred<StagingResult<RuntimePlan>>();
  const quiet = deferred<void>();
  const manager = create({ ...e.options, stagerFor: () => ({ prepare() {
    entered.resolve(); return { result: result.promise, quiesced: quiet.promise };
  } }) });
  await e.accepted(manager); const close = vi.spyOn(e.owner, 'closeOutputAbsence');
  const driving = manager.drive(scope(e.offer), operation()); await entered.promise;
  try {
    result.resolve({ ok: false, reason: 'provider' }); await manager.cancel(scope(e.offer));
    expect((await manager.inspect(scope(e.offer))).allocation?.status).toBe('charged');
    expect(close).not.toHaveBeenCalled(); expect(await e.owner.readOutputAbsence(scope(e.offer))).toBeNull();
    quiet.resolve(); expect(await driving).toEqual({ kind: 'released', collection: 'failed' });
    expect(await e.owner.readOutputAbsence(scope(e.offer))).toMatchObject({ reason: 'cancelled',
      admission: { state: 'released', disposition: 'never_started' } });
    expect(e.backend.starts).toBe(0); expect(entries(manager).size).toBe(0);
  } finally { quiet.resolve(); result.resolve({ ok: false, reason: 'provider' }); await Promise.allSettled([driving]); }
});

it('fresh cancelOriginal retains its metadata owner and owned native watch until durable absence commit', async () => {
  const e = await f.setup(); const manager = create(e.options); const key = scope(e.offer);
  const gate = deferred<void>(); const close = vi.fn(async () => { await gate.promise; });
  const entry = createEntry(key); entry.watch = { initial: Promise.resolve({ ready: true }),
    status: () => ({ ready: true, closed: false, stopRequested: false, lastKnownAt: 0 }), close };
  entries(manager).set(identity(key), entry);
  const absence = vi.spyOn(e.owner, 'closeOutputAbsence');
  const cancelling = manager.cancelOriginal(e.offer);
  try {
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect(absence).not.toHaveBeenCalled(); expect(entries(manager).size).toBe(1);
    expect(await e.owner.readOutputAbsence(key)).toBeNull();
    gate.resolve(); expect(await cancelling).toMatchObject({ admission: { state: 'rejected', reason: 'cancelled' } });
    expect(await e.owner.readOutputAbsence(key)).toMatchObject({ finalAgentSeq: 0, reason: 'cancelled' });
    expect(entries(manager).size).toBe(0); expect(e.backend.starts).toBe(0);
  } finally { gate.resolve(); await Promise.allSettled([cancelling]); }
});

it('failed original watch close is sticky and never reaches the trusted absence method', async () => {
  const e = await f.setup(); const manager = create(e.options); const key = scope(e.offer);
  await e.owner.cancelOriginal({ offer: e.offer, now: e.time.wall() });
  const entry = createEntry(key); const close = vi.fn(async () => { throw new Error('synthetic uncertain native close'); });
  entry.watch = { initial: Promise.resolve({ ready: true }),
    status: () => ({ ready: true, closed: false, stopRequested: false, lastKnownAt: 0 }), close };
  entries(manager).set(identity(key), entry); const absence = vi.spyOn(e.owner, 'closeOutputAbsence');
  await expect(manager.drive(key, operation())).rejects.toMatchObject({ reason: 'cleanup' });
  const original = entry.nativeRetirement;
  await expect(manager.drive(key, operation())).rejects.toMatchObject({ reason: 'cleanup' });
  expect(entry.nativeRetirement).toBe(original); expect(close).toHaveBeenCalledTimes(1); expect(absence).not.toHaveBeenCalled();
  expect(entries(manager).size).toBe(1); expect(await e.owner.readOutputAbsence(key)).toBeNull();
  await expect(manager.close()).rejects.toMatchObject({ reason: 'cleanup' });
});

it('failed actual controller close retains supervisor custody and never publishes absence after durable failed collection release', async () => {
  const e = await f.setup(); const manager = create(e.options); await e.accepted(manager);
  await manager.drive(scope(e.offer), operation()); const entry = [...entries(manager).values()][0]!;
  const close = vi.spyOn(entry.controller!, 'close').mockRejectedValue(new Error('synthetic unknown controller cleanup'));
  const absence = vi.spyOn(e.owner, 'closeOutputAbsence'); e.backend.observation = e.backend.known('exited').value;
  await expect(e.finish(manager)).rejects.toMatchObject({ reason: 'cleanup' });
  expect((await e.owner.get(entry.key)).admission).toEqual({ state: 'released', disposition: 'settled' });
  await expect(manager.drive(entry.key, operation())).rejects.toMatchObject({ reason: 'cleanup' });
  expect(close).toHaveBeenCalledTimes(1); expect(absence).not.toHaveBeenCalled(); expect(await e.owner.readOutputAbsence(entry.key)).toBeNull();
  expect(e.manager.size).toBe(1); expect(entries(manager).size).toBe(1);
  await expect(manager.close()).rejects.toMatchObject({ reason: 'cleanup' }); expect(close).toHaveBeenCalledTimes(1);
});
