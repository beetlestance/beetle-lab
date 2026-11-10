import { expect, it, vi } from 'vitest';
import type { Reservation } from '../../src/admission/index.js';
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
  expect(await e.controller.tick(budget())).toMatchObject({ kind: 'runtime' });
  expect(e.collections).toHaveLength(0); expect(await e.journal.readOutputCollection(e.key)).toBeNull();
  expect(reserved(await e.journal.admission({ kind: 'reservation', key: e.key })).status).toBe('charged');
  e.time.advance(1);
  expect(await e.controller.tick(budget())).toEqual({ kind: 'awaiting_release', collection: 'finished' });
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
  await expect.poll(() => e.backend.starts).toBe(1);
  const cancel = e.controller.cancel();
  await expect.poll(async () => (await e.journal.get(e.key)).cancelRequested).toBe(true);
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
const abortReplyFaults = {
  charged: (value: Reservation) => { value.status = 'charged'; },
  nonaborted: (value: Reservation) => { value.aborted = false; },
  scope: (value: Reservation) => { value.workspaceId = value.attemptId; },
  releaseEvidence: (value: Reservation) => { Reflect.set(value, 'releaseEvidence', { contradictoryAbort: true }); },
  createToken: (value: Reservation) => { value.createToken = 'unexpected'; },
  specDigest: (value: Reservation) => { value.specDigest = 'a'.repeat(64); },
  runtimeId: (value: Reservation) => { value.runtimeId = 'unexpected'; },
  startToken: (value: Reservation) => { value.startToken = 'unexpected'; },
  startClaimedAt: (value: Reservation) => { value.startClaimedAt = value.admittedAt; },
  launchEpoch: (value: Reservation) => { value.launchEpoch = 1; },
  launchSettlement: (value: Reservation) => { Reflect.set(value, 'launchSettlement', { contradictoryAbort: true }); },
  launchClosed: (value: Reservation) => { value.launchClosed = false; },
};
it.each(Object.keys(abortReplyFaults) as (keyof typeof abortReplyFaults)[])('refuses contradictory unstarted abort reply %s before reporting release', async fault => {
  const e = await f.setupController(); await e.controller.cancel(); const admission = e.journal.admission.bind(e.journal);
  const spy = vi.spyOn(e.journal, 'admission').mockImplementation(async input => {
    if (input.kind !== 'abortUnstarted') return admission(input);
    const value = structuredClone(reserved(await admission({ kind: 'reservation', key: input.key })));
    value.status = 'released'; value.aborted = true; value.launchClosed = true; abortReplyFaults[fault](value);
    return value;
  });
  try {
    await expect(e.controller.launch(budget())).rejects.toMatchObject({ reason: 'journal' });
    expect(reserved(await admission({ kind: 'reservation', key: e.key }))).toMatchObject({ status: 'charged', aborted: false,
      createToken: null, startToken: null, runtimeId: null, releaseEvidence: null });
    expect(() => e.recreate()).toThrowError(ControllerError); expect(e.backend.creates).toBe(0); expect(e.backend.starts).toBe(0);
    spy.mockImplementation(admission);
    expect(await e.controller.tick(budget())).toEqual({ kind: 'released', collection: 'failed' });
    const aborts = spy.mock.calls.map(([input]) => input).filter(input => input.kind === 'abortUnstarted');
    expect(aborts).toHaveLength(2); expect(aborts[1]!.key).toBe(aborts[0]!.key); expect(aborts[1]!.key).toEqual(e.key);
    expect(reserved(await admission({ kind: 'reservation', key: e.key }))).toMatchObject({ status: 'released', aborted: true, releaseEvidence: null });
  } finally { spy.mockRestore(); }
});
it('a false abort acknowledgement during close cannot retire the unstarted owner', async () => {
  const e = await f.setupController(); const admission = e.journal.admission.bind(e.journal);
  const spy = vi.spyOn(e.journal, 'admission').mockImplementation(input => input.kind === 'abortUnstarted'
    ? admission({ kind: 'reservation', key: input.key }) : admission(input));
  try {
    const closing = e.controller.close(); await expect(closing).rejects.toMatchObject({ reason: 'journal' });
    expect(e.controller.close()).toBe(closing);
    expect(reserved(await admission({ kind: 'reservation', key: e.key }))).toMatchObject({ status: 'charged', aborted: false });
    expect(() => e.recreate()).toThrowError(ControllerError);
    expect(e.backend.creates).toBe(0); expect(e.backend.starts).toBe(0);
  } finally { spy.mockRestore(); }
});
