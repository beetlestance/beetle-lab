import { expect, it, vi } from 'vitest';
import { Supervisor } from '../../src/supervisor/index.js';
import type { LiveMetricApprovalFactory } from '../../src/supervisor/index.js';
import type { MailboxArchiveReply, Operation } from '../../src/backends/docker/index.js';
import { frame, image } from '../live-metrics/fixtures.js';
import { ControlledBackend, deferred, installationId, supervisorFixture } from './fixtures.js';

const f = supervisorFixture();
async function setup(reject = false) {
  const e = await f.setup(); const backend = new ControlledBackend();
  const value = frame({scope: e.input.key, capturedAtMs: e.time.wall(), publishedAtMs: e.time.wall(),
    startTimeMs: e.time.wall() - 1000, endTimeMs: e.time.wall()});
  const readMailbox = vi.fn(async (_plan: unknown, _operation: Operation): Promise<MailboxArchiveReply> => {
    void _plan; void _operation; return {ok: true, status: 200, image: image(value)};
  });
  const approve = vi.fn<LiveMetricApprovalFactory>(() => {
    if (reject) throw new Error('private policy error');
    return {scope: value.scope, producerEpoch: value.producerEpoch, subset: value.subset};
  });
  const manager = new Supervisor({journal: e.journal, installationId, clock: e.time,
    backendFactory: () => Object.assign(backend, {readMailbox}), liveMetricApproval: approve});
  return {...e, manager, backend, readMailbox, approve, value,
    operation: (): Operation => ({deadline: e.time.monotonic() + 5000})};
}
it('reads only an existing running owner approved from its validated immutable offer', async () => {
  const e = await setup();
  expect(await e.manager.readLiveMetrics(e.input.key, e.operation())).toEqual({ok: false, reason: 'unavailable'});
  expect(e.manager.size).toBe(0); expect(e.approve).not.toHaveBeenCalled();
  const actor = e.manager.actor(e.input);
  expect(await e.manager.readLiveMetrics(e.input.key, e.operation())).toEqual({ok: false, reason: 'unavailable'});
  await actor.launch(); await actor.tick();
  expect(e.approve).toHaveBeenCalledTimes(1); expect(e.approve).toHaveBeenCalledWith(e.offer, e.input);
  expect(await e.manager.readLiveMetrics(e.input.key, e.operation())).toEqual({ok: true, frame: e.value});
  expect(await e.manager.readLiveMetrics({...e.input.key, generation: 2}, e.operation())).toEqual({ok: false, reason: 'unavailable'});
  expect(e.backend.starts).toBe(1); await e.manager.closeTelemetry();
});
it('keeps policy rejection advisory and never learns approval from mailbox bytes', async () => {
  const e = await setup(true); const actor = e.manager.actor(e.input); await actor.launch();
  expect(e.backend.starts).toBe(1);
  expect(await actor.readLiveMetrics(e.operation())).toEqual({ok: false, reason: 'unavailable'});
  expect(e.readMailbox).not.toHaveBeenCalled(); expect(e.approve).toHaveBeenCalledTimes(1);
  await actor.tick(); expect(e.approve).toHaveBeenCalledTimes(1); await e.manager.closeTelemetry();
});
it('retains a cancelled mailbox original through shutdown and refuses retirement while held', async () => {
  const e = await setup(); const actor = e.manager.actor(e.input); await actor.launch();
  const gate = deferred<MailboxArchiveReply>(); let signal: AbortSignal | undefined;
  e.readMailbox.mockImplementation((_plan, operation) => {signal = operation.signal; return gate.promise;});
  const read = actor.readLiveMetrics(e.operation());
  await expect.poll(() => e.readMailbox.mock.calls.length).toBe(1);
  expect(() => e.manager.retire(e.input)).toThrow('conflict');
  let closed = false; const closing = e.manager.closeTelemetry().then(() => {closed = true;});
  await Promise.resolve(); expect(signal?.aborted).toBe(true); expect(closed).toBe(false);
  expect(await e.manager.readLiveMetrics(e.input.key, e.operation())).toEqual({ok: false, reason: 'closed'});
  gate.resolve({ok: true, status: 200, image: image(e.value)});
  expect(await read).toEqual({ok: false, reason: 'closed'}); await closing;
  e.manager.retire(e.input); expect(await actor.readLiveMetrics(e.operation())).toEqual({ok: false, reason: 'closed'});
});
it('keeps control cancellation independent and fences a late advisory reply', async () => {
  const e = await setup(); const actor = e.manager.actor(e.input); await actor.launch();
  const gate = deferred<MailboxArchiveReply>(); e.readMailbox.mockImplementation(() => gate.promise);
  const read = actor.readLiveMetrics(e.operation()); await expect.poll(() => e.readMailbox.mock.calls.length).toBe(1);
  await actor.cancel(); expect(e.backend.stops).toHaveLength(1);
  gate.resolve({ok: true, status: 200, image: image(e.value)});
  expect(await read).toEqual({ok: false, reason: 'closed'}); await e.manager.closeTelemetry();
});
