import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openAgentOwners } from '../../src/bootstrap/agent-owners.js';
import { deferred, flush, outputOwnerFixture } from './fixture.js';
import { keyFor } from '../delivery/fixture.js';

const mocks = vi.hoisted(() => ({ start: vi.fn() }));
vi.mock('../../src/adapters/outbound/runner/index.js', () => ({ startDeliveryRuntime: mocks.start }));
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(10000); mocks.start.mockReset(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it('owns output initialization before any capacity or delivery work and captures methods before awaiting it', async () => {
  const f = outputOwnerFixture(mocks.start); const opened = deferred<typeof f.output>();
  f.openOutputs.mockReturnValueOnce(opened.promise);
  const sample = f.source.sample; const publish = f.metadata.updateRuntime;
  const closeSource = f.source.close; const closeGateway = f.gateway.close;
  const opening = openAgentOwners(f); await flush();
  expect(f.openOutputs).toHaveBeenCalledOnce(); expect(sample).not.toHaveBeenCalled();
  expect(mocks.start).not.toHaveBeenCalled(); expect(publish).not.toHaveBeenCalled();
  f.source.sample = vi.fn(async () => null); f.source.close = vi.fn(async () => {});
  f.metadata.updateRuntime = vi.fn(async () => null); f.gateway.close = vi.fn(async () => {});
  opened.resolve(f.output); const runtime = await opening; await flush();
  expect(sample).toHaveBeenCalledOnce(); expect(publish).toHaveBeenCalledWith(f.frame);
  const outputClose = f.output.close; f.output.close = vi.fn(async () => {});
  await runtime.close();
  expect(outputClose).toHaveBeenCalledOnce(); expect(closeSource).toHaveBeenCalledOnce();
  expect(closeGateway).toHaveBeenCalledOnce(); expect(f.output.close).not.toHaveBeenCalled();
});
it('rejects early output failure after draining returned ownership without advertising capacity', async () => {
  const f = outputOwnerFixture(mocks.start); const failure = new Error('Synthetic early output failure');
  const held = deferred<void>(); vi.mocked(f.output.close).mockReturnValueOnce(held.promise);
  f.openOutputs.mockImplementationOnce(async notify => { await notify(failure); return f.output; });
  let settled = false;
  const opening = openAgentOwners(f).catch(error => { settled = true; return error; });
  await flush();
  expect(settled).toBe(false); expect(f.output.close).toHaveBeenCalledOnce();
  expect(f.source.sample).not.toHaveBeenCalled(); expect(mocks.start).not.toHaveBeenCalled();
  expect(f.metadata.updateRuntime.mock.calls).toEqual([[null]]); expect(f.gateway.close).not.toHaveBeenCalled();
  held.resolve(); expect(await opening).toBe(failure);
  expect(f.source.close).toHaveBeenCalledOnce(); expect(f.gateway.close).toHaveBeenCalledOnce();
});
it('binds delivery metadata and gateway methods before held output initialization despite caller replacement', async () => {
  const f = outputOwnerFixture(mocks.start); const held = deferred<typeof f.output>();
  const original = new Error('Synthetic captured delivery method'); const replacement = new Error('Synthetic replacement method');
  f.metadata.dispatch.scan.mockRejectedValue(original); f.metadata.events.load.mockRejectedValue(original);
  f.metadata.runs.getRun.mockRejectedValue(original);
  const scan = f.metadata.dispatch.scan; const load = f.metadata.events.load; const getRun = f.metadata.runs.getRun;
  const attempt = f.gateway.attempt;
  f.openOutputs.mockReturnValueOnce(held.promise); const opening = openAgentOwners(f); await flush();
  f.metadata.dispatch.scan = vi.fn(async () => { throw replacement; });
  f.metadata.events.load = vi.fn(async () => { throw replacement; });
  f.metadata.runs.getRun = vi.fn(async () => { throw replacement; });
  f.gateway.attempt = vi.fn(() => { throw replacement; });
  held.resolve(f.output); const runtime = await opening;
  const delivery = f.options(); if (!delivery) throw new Error('Missing delivery options');
  const key = keyFor(); const binding = { key, journalAuthority: '33333333-3333-4333-8333-333333333333' };
  const identity = { ...key.attempt, journalAuthority: binding.journalAuthority };
  try {
    await expect(delivery.store.scan({ lane: 'queued', limit: 1 })).rejects.toBe(original);
    await expect(delivery.events.load(binding)).rejects.toBe(original);
    await expect(delivery.runs.getRun({ id: key.runId, scope: { kind: 'workspace',
      organizationId: key.attempt.organizationId, workspaceId: key.attempt.workspaceId } })).rejects.toBe(original);
    expect(() => delivery.gateway.attempt(identity)).toThrow('Unexpected client');
    expect(attempt).toHaveBeenCalledWith(identity); expect(f.gateway.attempt).not.toHaveBeenCalled();
    for (const [method, context] of [[scan, f.metadata.dispatch], [load, f.metadata.events], [getRun, f.metadata.runs]] as const) {
      expect(method).toHaveBeenCalledOnce(); expect(method.mock.contexts[0]).toBe(context);
    }
    expect(f.metadata.dispatch.scan).not.toHaveBeenCalled(); expect(f.metadata.events.load).not.toHaveBeenCalled();
    expect(f.metadata.runs.getRun).not.toHaveBeenCalled();
  } finally { await runtime.close(); }
});
it('retains failed output startup plus source and connection cleanup failures', async () => {
  const f = outputOwnerFixture(mocks.start); const original = new Error('Synthetic factory rejection');
  const source = new Error('Synthetic source cleanup'); const gateway = new Error('Synthetic gateway cleanup');
  f.openOutputs.mockRejectedValueOnce(original); vi.mocked(f.source.close).mockRejectedValueOnce(source);
  vi.mocked(f.gateway.close).mockRejectedValueOnce(gateway);
  await expect(openAgentOwners(f)).rejects.toMatchObject({ errors: [original, expect.objectContaining({ errors: [source, gateway] })] });
  expect(f.source.sample).not.toHaveBeenCalled(); expect(mocks.start).not.toHaveBeenCalled();
});
it('keeps the connection until an output original and both other loops retire, with cached close', async () => {
  const f = outputOwnerFixture(mocks.start); const held = deferred<void>();
  vi.mocked(f.output.close).mockReturnValueOnce(held.promise);
  const runtime = await openAgentOwners(f); await flush();
  const close = runtime.close(); expect(runtime.close()).toBe(close);
  expect(f.output.close).toHaveBeenCalledOnce(); expect(f.delivery.close).toHaveBeenCalledOnce();
  await flush(); expect(f.source.close).toHaveBeenCalledOnce(); expect(f.gateway.close).not.toHaveBeenCalled();
  held.resolve(); await close; expect(f.gateway.close).toHaveBeenCalledOnce();
});
it('output failure drains an issued publication before revocation and never awaits its own close', async () => {
  const f = outputOwnerFixture(mocks.start); const issued = deferred<null>(); const original = new Error('Synthetic output failure');
  f.metadata.updateRuntime.mockImplementationOnce(() => issued.promise);
  const runtime = await openAgentOwners(f); await flush();
  const notification = f.failOutput(original);
  expect(runtime.state()).toMatchObject({ status: 'failed', reason: 'output_failure' });
  expect(f.delivery.close).toHaveBeenCalledOnce(); expect(f.output.close).not.toHaveBeenCalled();
  const close = runtime.close(); const checked = expect(close).rejects.toBe(original);
  await flush(); expect(f.gateway.close).not.toHaveBeenCalled();
  expect(f.metadata.updateRuntime.mock.calls).toEqual([[f.frame]]);
  issued.resolve(null); await notification; await checked;
  expect(f.metadata.updateRuntime.mock.calls).toEqual([[f.frame], [null]]);
  await vi.advanceTimersByTimeAsync(2000); expect(f.source.sample).toHaveBeenCalledOnce();
});
it('fences outputs on delivery failure without awaiting the output original inside the callback', async () => {
  const f = outputOwnerFixture(mocks.start); const held = deferred<void>(); const original = new Error('Synthetic delivery failure');
  vi.mocked(f.output.close).mockReturnValueOnce(held.promise);
  const runtime = await openAgentOwners(f); await flush();
  await f.fail(original);
  expect(f.output.close).toHaveBeenCalledOnce(); expect(f.metadata.updateRuntime).toHaveBeenLastCalledWith(null);
  const close = runtime.close(); const checked = expect(close).rejects.toBe(original);
  await flush(); expect(f.gateway.close).not.toHaveBeenCalled(); held.resolve(); await checked;
});
it('allows concurrent output and delivery failure callbacks to share revocation without a drain cycle', async () => {
  const f = outputOwnerFixture(mocks.start); const revoked = deferred<null>();
  const runtime = await openAgentOwners(f); await flush();
  f.metadata.updateRuntime.mockImplementationOnce(() => revoked.promise);
  const output = new Error('Synthetic output failure'); const delivery = new Error('Synthetic delivery failure');
  const first = f.fail(delivery); const second = f.failOutput(output);
  const close = runtime.close(); const checked = expect(close).rejects.toBeInstanceOf(AggregateError);
  await flush(); expect(f.gateway.close).not.toHaveBeenCalled();
  revoked.resolve(null); await Promise.all([first, second]); await checked;
  expect(f.metadata.updateRuntime.mock.calls).toEqual([[f.frame], [null]]);
  expect(f.output.close).toHaveBeenCalledOnce(); expect(f.delivery.close).toHaveBeenCalledOnce();
});
it.each(['source_failure', 'publication_failure'] as const)('fences output work on %s and preserves all original drains', async reason => {
  const f = outputOwnerFixture(mocks.start); const original = new Error('Synthetic producer failure');
  const held = deferred<void>(); vi.mocked(f.output.close).mockReturnValueOnce(held.promise);
  if (reason === 'source_failure') vi.mocked(f.source.sample).mockRejectedValueOnce(original);
  else f.metadata.updateRuntime.mockRejectedValueOnce(original);
  const runtime = await openAgentOwners(f); await flush();
  expect(runtime.state()).toMatchObject({ status: 'failed', reason });
  expect(f.output.close).toHaveBeenCalledOnce(); expect(f.delivery.close).toHaveBeenCalledOnce();
  const close = runtime.close(); const checked = expect(close).rejects.toBe(original);
  await flush(); expect(f.gateway.close).not.toHaveBeenCalled(); held.resolve(); await checked;
});
