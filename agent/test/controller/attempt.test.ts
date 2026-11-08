import { expect, it } from 'vitest';
import { ControllerError } from '../../src/controller/index.js';
import { fixture, budget } from './fixtures.js';
import { reserved } from '../admission/fixtures.js';
import { deferred } from '../supervisor/fixtures.js';

const f = fixture();
it('composes launch, atomic control commit, stopped collection and later capacity release without app finalization', async () => {
  const e = await f.setupController();
  expect(await e.controller.launch(budget())).toEqual({ kind: 'control', events: 1 });
  expect(e.backend.creates).toBe(1); expect(e.backend.starts).toBe(1);
  expect(await e.journal.readWrapperCheckpoint(e.key)).toMatchObject({ wrapperSeq: 1 });
  expect(e.readers[0]!.budgets[0]!.stopped).toBe(false); expect(e.collections).toHaveLength(0);
  e.time.advance(1); e.backend.observation = e.backend.known('exited').value;
  expect(await e.controller.tick(budget())).toEqual({ kind: 'awaiting_release', collection: 'finished' });
  expect(e.collections).toHaveLength(1); expect(e.outputClose()).toBe(1);
  expect(e.collections[0]).toMatchObject({ key: e.key, engineId: 'k6', reportedResult: e.event.payload });
  expect(await e.controller.tick(budget())).toEqual({ kind: 'released', collection: 'finished' });
  const value = reserved(await e.journal.admission({ kind: 'reservation', key: e.key }));
  expect(value.status).toBe('released'); expect(value.releaseEvidence?.collection.state).toBe('finished');
  expect((await e.journal.get(e.key)).result).toEqual(e.event.payload);
  expect(e.backend.starts).toBe(1); expect(await e.controller.tick(budget())).toEqual({ kind: 'released', collection: 'finished' });
  await e.controller.close();
});
it('retains charges until a strictly later real wall-clock observation; no fabricated timestamp', async () => {
  const e = await f.setupController(); await e.controller.launch(budget());
  e.backend.observation = e.backend.known('exited').value;
  await e.controller.tick(budget());
  expect(await e.controller.tick(budget())).toEqual({ kind: 'awaiting_release', collection: 'finished' });
  expect(reserved(await e.journal.admission({ kind: 'reservation', key: e.key })).status).toBe('charged');
  e.time.advance(1);
  expect(await e.controller.tick(budget())).toEqual({ kind: 'released', collection: 'finished' });
});
it('never upgrades uncertain launch dispatches to stopped collection or released capacity', async () => {
  const e = await f.setupController(); e.backend.startResult = { outcome: 'unknown', reason: 'unavailable' };
  await e.controller.launch(budget()); e.time.advance(1); e.backend.observation = e.backend.known('exited').value;
  expect(await e.controller.tick(budget())).toMatchObject({ kind: 'runtime', state: { launch: 'unknown' } });
  expect(e.readers[0]!.budgets.at(-1)!.stopped).toBe(false); expect(e.collections).toHaveLength(0);
  expect(reserved(await e.journal.admission({ kind: 'reservation', key: e.key })).status).toBe('charged');
});
it('does not release when outputs report failure before original IO quiesces', async () => {
  const e = await f.setupController(); await e.controller.launch(budget());
  const quiet = deferred<void>(); let closeCalls = 0;
  e.setOutput(() => ({ result: Promise.resolve({ ok: false, reason: 'integrity' }), quiesced: quiet.promise,
    close: async () => { closeCalls++; await quiet.promise; } }));
  e.time.advance(1); e.backend.observation = e.backend.known('exited').value;
  const collecting = e.controller.tick(budget());
  await new Promise(resolve => setTimeout(resolve, 25));
  expect(e.collections).toHaveLength(1); expect(closeCalls).toBe(0);
  expect(reserved(await e.journal.admission({ kind: 'reservation', key: e.key })).status).toBe('charged');
  await expect(e.controller.tick(budget())).rejects.toMatchObject({ reason: 'busy' });
  quiet.resolve(); expect(await collecting).toEqual({ kind: 'awaiting_release', collection: 'failed' });
  expect(await e.controller.tick(budget())).toEqual({ kind: 'released', collection: 'failed' });
});
it('preserves failed original output close and refuses capacity release', async () => {
  const e = await f.setupController(); await e.controller.launch(budget());
  const failure = Promise.reject(new Error('original close')); void failure.catch(() => undefined);
  e.setOutput(() => ({ result: Promise.resolve({ ok: false, reason: 'io' }), quiesced: Promise.resolve(), close: () => failure }));
  e.time.advance(1); e.backend.observation = e.backend.known('exited').value;
  await expect(e.controller.tick(budget())).rejects.toMatchObject({ reason: 'cleanup' });
  await expect(e.controller.tick(budget())).rejects.toMatchObject({ reason: 'cleanup' });
  expect(reserved(await e.journal.admission({ kind: 'reservation', key: e.key })).status).toBe('charged');
  const close = e.controller.close(); expect(e.controller.close()).toBe(close);
  await expect(close).rejects.toMatchObject({ reason: 'cleanup' });
});
it('invalid or accessor budgets perform no launch and a subsequent valid call still works', async () => {
  const e = await f.setupController(); let calls = 0;
  const invalid = { get deadline() { calls++; return performance.now() + 5000; } };
  await expect(e.controller.launch(invalid)).rejects.toMatchObject({ reason: 'invalid_input' });
  expect(calls).toBe(0); expect(e.backend.creates).toBe(0);
  await e.controller.launch(budget()); expect(e.backend.starts).toBe(1);
  expect(new ControllerError('busy').message).not.toContain(e.key.attemptId);
});
it('cancellation while start is pending persists intent and prevents release until dispatch resolves', async () => {
  const e = await f.setupController(); e.backend.startHold = deferred();
  const launch = e.controller.launch(budget());
  while (e.backend.starts === 0) await new Promise(resolve => setTimeout(resolve, 1));
  const cancel = e.controller.cancel();
  while (!(await e.journal.get(e.key)).cancelRequested) await new Promise(resolve => setTimeout(resolve, 1));
  expect(reserved(await e.journal.admission({ kind: 'reservation', key: e.key })).status).toBe('charged');
  e.backend.startHold.resolve(e.backend.known('running'));
  await launch; await cancel;
  expect(e.backend.stops).toEqual([e.time.monotonic() + 5000, e.time.monotonic() + 5000]);
  expect(e.backend.starts).toBe(1);
});
it('cancel before launch has a clocked durable origin and safely aborts an unclaimed reservation', async () => {
  const e = await f.setupController(); await e.controller.cancel();
  expect(await e.journal.supervision({ key: e.key, now: e.time.wall() })).toMatchObject({
    cancelRequested: true, cancelRequestedAt: e.time.wall(), clockFenced: false });
  expect(await e.controller.launch(budget())).toEqual({ kind: 'released', collection: 'failed' });
  expect(e.backend.creates).toBe(0); expect(e.backend.starts).toBe(0);
  expect(reserved(await e.journal.admission({ kind: 'reservation', key: e.key }))).toMatchObject({ status: 'released', aborted: true });
});
it('close before launch aborts only after its owned work settles and permits a new durable-state reader', async () => {
  const e = await f.setupController(); await e.controller.close();
  expect(reserved(await e.journal.admission({ kind: 'reservation', key: e.key }))).toMatchObject({ status: 'released', aborted: true });
  const { AttemptController } = await import('../../src/controller/attempt.js');
  const next = new AttemptController(e.controllerOptions);
  expect(await next.tick(budget())).toEqual({ kind: 'released', collection: 'failed' }); await next.close();
  expect(e.backend.creates).toBe(0);
});
it('rejects duplicate owners until the original controller closes', async () => {
  const e = await f.setupController(); const { AttemptController } = await import('../../src/controller/attempt.js');
  expect(() => new AttemptController(e.controllerOptions)).toThrowError(ControllerError);
  await e.controller.close();
  const next = new AttemptController(e.controllerOptions); await next.close();
});
it('close from a budget descriptor trap cannot allow late launch or orphan its active promise', async () => {
  const e = await f.setupController(); let close: Promise<void> | undefined;
  const input = new Proxy(budget(), { getOwnPropertyDescriptor(target, property) {
    close ??= e.controller.close(); return Reflect.getOwnPropertyDescriptor(target, property);
  } });
  await expect(e.controller.launch(input)).rejects.toMatchObject({ reason: 'closed' });
  await close; expect(e.backend.creates).toBe(0);
});
