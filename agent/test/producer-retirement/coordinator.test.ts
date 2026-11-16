import { afterEach, expect, it, vi } from 'vitest';
import { ProducerRetirementError, producerBarrierFacts } from '../../src/producer-retirement/index.js';
import type { ProducerBarrier } from '../../src/producer-retirement/index.js';
import { deferred, until } from '../output-transfer/fixtures.js';
import { model, original } from './coordinator-fixtures.js';
afterEach(() => { vi.useRealTimers(); });
it('binds an opaque producer-only capability to the exact immutable intent and revokes it on close', async () => {
  const e = model(); const input = structuredClone(original); const work = e.coordinator.retire(input);
  expect(e.coordinator.retire(original)).toBe(work);
  const outcome = await work.result; await work.settled;
  expect(outcome.ok).toBe(true); if (!outcome.ok) throw new Error('Missing barrier');
  expect(producerBarrierFacts(outcome.value).intent).toEqual(e.intent);
  expect(() => producerBarrierFacts({} as ProducerBarrier)).toThrow('closed');
  expect(e.installation.retireOutput).toHaveBeenCalledTimes(1); expect(e.coordinator.status().retained).toBe(0);
  await e.coordinator.close(); expect(() => producerBarrierFacts(outcome.value)).toThrow('closed');
});
it('does not fence on failed preflight or issue a mutating begin', async () => {
  const e = model(); vi.mocked(e.port.preflight).mockRejectedValue(new ProducerRetirementError('conflict'));
  const work = e.coordinator.retire(original); expect(await work.result).toEqual({ ok: false, reason: 'conflict' }); await work.settled;
  expect(e.port.begin).not.toHaveBeenCalled(); expect(e.gate.status()).toEqual({ entries: 0, leases: 0 });
  expect(e.coordinator.status().retained).toBe(0); await e.coordinator.close();
});
it('waits the actual carrier after rejected begin before reading status or dispatching a native barrier', async () => {
  const e = model(); const carrier = deferred<void>(); e.records.set(original.attemptId, e.intent);
  vi.mocked(e.port.begin).mockRejectedValue(new Error('lost reply')); vi.mocked(e.port.settleCarrier).mockReturnValue(carrier.promise);
  const work = e.coordinator.retire(original); let settled = false; void work.settled.then(() => { settled = true; });
  await until(() => vi.mocked(e.port.settleCarrier).mock.calls.length === 1);
  expect(e.port.read).not.toHaveBeenCalled(); expect(e.installation.retireOutput).not.toHaveBeenCalled(); expect(settled).toBe(false);
  carrier.resolve(); expect((await work.result).ok).toBe(true); await work.settled; expect(e.port.read).toHaveBeenCalledTimes(2);
  await e.coordinator.close();
});
it('retains an unknown carrier termination and refuses retries or successful shutdown', async () => {
  const e = model(); vi.mocked(e.port.begin).mockRejectedValue(new Error('unknown write'));
  vi.mocked(e.port.settleCarrier).mockRejectedValue(new Error('unknown termination'));
  const work = e.coordinator.retire(original); expect(await work.result).toEqual({ ok: false, reason: 'cleanup' }); await work.settled;
  expect(e.port.read).not.toHaveBeenCalled(); expect(e.installation.retireOutput).not.toHaveBeenCalled();
  expect(e.coordinator.status().retained).toBe(1); expect(() => e.coordinator.retire(original)).toThrow('cleanup');
  await expect(e.coordinator.close()).rejects.toThrow('cleanup');
});
it('expires publicly while actual read and native originals remain held, then retries with fresh inspection and no late token', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); let now = 100;
  const e = model({ now: () => now }); const held = deferred<void>(); vi.mocked(e.installation.retireOutput).mockReturnValueOnce(held.promise);
  const read = e.gate.acquire(e.key); await read.ready(); read.issue(() => ({ native: 'synthetic held read' }));
  const work = e.coordinator.retire(original); let settled = false; void work.settled.then(() => { settled = true; });
  for (let n = 0; n < 30 && !e.installation.retireOutput.mock.calls.length; n++) await Promise.resolve();
  expect(e.installation.retireOutput).toHaveBeenCalledTimes(1); now += 30_000; await vi.advanceTimersByTimeAsync(30_000);
  expect(await work.result).toEqual({ ok: false, reason: 'expired' }); expect(settled).toBe(false);
  expect(e.coordinator.retire(original)).toBe(work); expect(() => e.coordinator.retire({ ...original, deletionId: original.runId })).toThrow('conflict');
  read.finish(); held.resolve(); await work.settled; expect(e.coordinator.status().retained).toBe(0);
  const retry = e.coordinator.retire(original); const result = await retry.result; await retry.settled;
  expect(result.ok).toBe(true); expect(e.installation.retireOutput).toHaveBeenCalledTimes(2);
  expect(e.coordinator.status().retained).toBe(0); await e.coordinator.close();
});
it('rejects poisoned read cleanup, retaining the original entry and capacity', async () => {
  const e = model(); const lease = e.gate.acquire(e.key); await lease.ready(); lease.issue(() => ({}));
  const work = e.coordinator.retire(original);
  await until(() => e.installation.retireOutput.mock.calls.length === 1); lease.poison();
  expect(await work.result).toEqual({ ok: false, reason: 'cleanup' }); await work.settled;
  expect(e.gate.status().leases).toBe(1); expect(() => e.coordinator.retire(original)).toThrow('cleanup');
  await expect(e.coordinator.close()).rejects.toThrow('cleanup');
});
it('includes held preflight in the whole budget without fencing normal intake or issuing begin', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); const e = model({ now: () => 100 });
  const preflight = deferred<typeof e.intent>(); vi.mocked(e.port.preflight).mockReturnValue(preflight.promise);
  const work = e.coordinator.retire(original); await Promise.resolve(); await Promise.resolve();
  await vi.advanceTimersByTimeAsync(30_000); expect(await work.result).toEqual({ ok: false, reason: 'expired' });
  const lease = e.gate.acquire(e.key); await lease.ready(); lease.finish(); expect(e.port.begin).not.toHaveBeenCalled();
  preflight.resolve(e.intent); await work.settled; expect(e.coordinator.status().retained).toBe(0); await e.coordinator.close();
});
it('shutdown waits held native settlement, revokes issuance and can clear known fully drained custody', async () => {
  const e = model(); const held = deferred<void>(); e.installation.retireOutput.mockReturnValueOnce(held.promise);
  const work = e.coordinator.retire(original); await until(() => e.installation.retireOutput.mock.calls.length === 1);
  let closed = false; const closing = e.coordinator.close().then(() => { closed = true; });
  expect(await work.result).toEqual({ ok: false, reason: 'closed' }); await Promise.resolve(); expect(closed).toBe(false);
  held.resolve(); await work.settled; await closing; expect(e.coordinator.status().retained).toBe(0); await e.gate.close();
});
it('does not dispatch late reconciliation after an expired held carrier; a settled retry uses a fresh budget', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); const e = model({ now: () => 100 });
  const carrier = deferred<void>(); e.records.set(original.attemptId, e.intent);
  vi.mocked(e.port.begin).mockRejectedValue(new Error('lost committed reply')); vi.mocked(e.port.settleCarrier).mockReturnValue(carrier.promise);
  const work = e.coordinator.retire(original);
  for (let n = 0; n < 30 && !vi.mocked(e.port.settleCarrier).mock.calls.length; n++) await Promise.resolve();
  expect(e.port.settleCarrier).toHaveBeenCalledTimes(1); await vi.advanceTimersByTimeAsync(30_000);
  expect(await work.result).toEqual({ ok: false, reason: 'expired' }); carrier.resolve(); await work.settled;
  expect(e.port.read).not.toHaveBeenCalled(); expect(e.installation.retireOutput).not.toHaveBeenCalled();
  expect(e.coordinator.status().retained).toBe(1);
  const next = e.coordinator.retire(original); expect((await next.result).ok).toBe(true); await next.settled;
  expect(e.port.read).toHaveBeenCalledTimes(2); await e.coordinator.close();
});
