import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openAgentOwners } from '../../src/bootstrap/agent-owners.js';
import { ownerFixture, deferred, flush } from './agent-owners-fixture.js';

const mocks = vi.hoisted(() => ({ start: vi.fn() }));
vi.mock('../../src/adapters/outbound/runner/index.js', () => ({ startDeliveryRuntime: mocks.start }));
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(10000); mocks.start.mockReset(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it('passes the shared gateway/store/readers to delivery and drains both loops before the gateway', async () => {
  const f = ownerFixture(mocks.start); const held = deferred<void>();
  f.delivery.close.mockReturnValue(held.promise);
  const runtime = await openAgentOwners(f); await flush();
  expect(f.options()?.gateway).toBe(f.gateway); expect(f.options()?.store).toBe(f.metadata.dispatch);
  expect(f.options()?.runs).toBe(f.metadata.runs);
  expect(Object.isFrozen(runtime)).toBe(true);
  const { close: closeRuntime } = runtime;
  const close = closeRuntime(); expect(runtime.close()).toBe(close);
  expect(f.delivery.close).toHaveBeenCalledOnce();
  await flush(); expect(f.source.close).toHaveBeenCalledOnce(); expect(f.gateway.close).not.toHaveBeenCalled();
  held.resolve(); await close;
  expect(f.gateway.close).toHaveBeenCalledOnce(); expect(runtime.state().status).toBe('closed');
});
it('fences failure immediately, drains an already-issued positive publication, then revokes with no later positive', async () => {
  const f = ownerFixture(mocks.start); const held = deferred<null>();
  f.metadata.updateRuntime.mockImplementationOnce(() => held.promise);
  const runtime = await openAgentOwners(f); await flush();
  expect(f.metadata.updateRuntime).toHaveBeenCalledTimes(1);
  const failure = new Error('Synthetic dispatch failure'); const notification = f.fail(failure);
  expect(runtime.state()).toMatchObject({ status: 'failed', reason: 'dispatch_failure' });
  await flush(); await vi.advanceTimersByTimeAsync(2000);
  expect(f.metadata.updateRuntime).toHaveBeenCalledTimes(1); expect(f.source.sample).toHaveBeenCalledOnce();
  held.resolve(null); await notification; await flush();
  expect(f.metadata.updateRuntime.mock.calls.map(([value]) => value)).toEqual([f.frame, null]);
  await vi.advanceTimersByTimeAsync(10000);
  expect(f.metadata.updateRuntime).toHaveBeenCalledTimes(2);
  await expect(runtime.close()).rejects.toBe(failure); expect(f.gateway.close).toHaveBeenCalledOnce();
});
it('still publishes null when poller shutdown rejects and retains operation plus revocation failures', async () => {
  const f = ownerFixture(mocks.start); const sourceFailure = new Error('Synthetic source close failure');
  const revocationFailure = new Error('Synthetic revocation failure');
  vi.mocked(f.source.close).mockRejectedValue(sourceFailure);
  const runtime = await openAgentOwners(f); await flush();
  f.metadata.updateRuntime.mockRejectedValueOnce(revocationFailure);
  const original = new Error('Synthetic delivery failure');
  const notification = f.fail(original);
  await expect(notification).rejects.toMatchObject({ errors: [sourceFailure, revocationFailure] });
  expect(f.metadata.updateRuntime.mock.calls.at(-1)).toEqual([null]);
  expect(runtime.state().status).toBe('failed');
  const close = runtime.close(); await expect(close).rejects.toBeInstanceOf(AggregateError);
  expect(runtime.close()).toBe(close); expect(f.gateway.close).toHaveBeenCalledOnce();
  expect(f.metadata.updateRuntime).toHaveBeenCalledTimes(2);
});
it('owns the pending null publication through callback and composite shutdown without awaiting itself', async () => {
  const f = ownerFixture(mocks.start); const revoked = deferred<null>();
  const runtime = await openAgentOwners(f); await flush();
  f.metadata.updateRuntime.mockImplementationOnce(() => revoked.promise);
  const original = new Error('Synthetic operation failure'); const notification = f.fail(original);
  await flush(); const close = runtime.close(); let done = false;
  const observed = close.catch(error => { done = true; return error; });
  await flush(); expect(done).toBe(false); expect(f.gateway.close).not.toHaveBeenCalled();
  revoked.resolve(null); await notification;
  expect(await observed).toBe(original); expect(f.gateway.close).toHaveBeenCalledOnce();
});
it('cleans up a poller and shared gateway exactly once when delivery construction fails', async () => {
  const f = ownerFixture(mocks.start); const failure = new Error('Synthetic delivery construction failure');
  mocks.start.mockImplementationOnce(() => { throw failure; });
  await expect(openAgentOwners(f)).rejects.toBe(failure);
  expect(f.source.close).toHaveBeenCalledOnce(); expect(f.gateway.close).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(2000);
  expect(f.metadata.updateRuntime).not.toHaveBeenCalled();
});
it('retains captured publisher and close methods through later caller mutation', async () => {
  const f = ownerFixture(mocks.start);
  const publish = f.metadata.updateRuntime; const closeSource = f.source.close; const closeGateway = f.gateway.close;
  const runtime = await openAgentOwners(f); await flush();
  f.metadata.updateRuntime = vi.fn(async () => null);
  f.source.close = vi.fn(async () => {}); f.gateway.close = vi.fn(async () => {});
  const failure = new Error('Synthetic captured owner failure'); await f.fail(failure);
  expect(publish).toHaveBeenLastCalledWith(null); expect(f.metadata.updateRuntime).not.toHaveBeenCalled();
  await expect(runtime.close()).rejects.toBe(failure);
  expect(closeSource).toHaveBeenCalledOnce(); expect(closeGateway).toHaveBeenCalledOnce();
  expect(f.source.close).not.toHaveBeenCalled(); expect(f.gateway.close).not.toHaveBeenCalled();
});
it.each(['source_failure', 'publication_failure'] as const)('stops new delivery synchronously on fatal %s and retains the producer failure', async reason => {
  const f = ownerFixture(mocks.start); const failure = new Error('Synthetic producer failure');
  if (reason === 'source_failure') vi.mocked(f.source.sample).mockRejectedValue(failure);
  else f.metadata.updateRuntime.mockRejectedValue(failure);
  const runtime = await openAgentOwners(f); await flush();
  expect(runtime.state()).toMatchObject({ status: 'failed', reason });
  expect(f.delivery.close).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(2000);
  expect(f.source.sample).toHaveBeenCalledOnce();
  await expect(runtime.close()).rejects.toBe(failure);
  expect(f.delivery.close).toHaveBeenCalledOnce(); expect(f.gateway.close).toHaveBeenCalledOnce();
});
