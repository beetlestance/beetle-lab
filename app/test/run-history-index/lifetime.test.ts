import { afterEach, expect, it, vi } from 'vitest';
import { pendingRunHistoryMetrics } from '@beetle/contracts/api';
import { startRunHistoryIndexer } from '../../src/application/run-history-index/index.js';
import type { RunHistoryIndexer, RunHistoryJob, RunHistoryProjection, RunHistoryStore, RunHistoryMetricReader } from '../../src/ports/run-history.js';
import { MetricReadError } from '../../src/ports/run-metrics.js';
import { scope, uuid } from '../storage/fixture.js';
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; }
const job: RunHistoryJob = { id: uuid(70), scope, attemptId: uuid(170), manifestDigest: 'a'.repeat(64), sourceDigest: 'b'.repeat(64), absenceProofDigest: null, expectedDueMs: 0 };
const owners: RunHistoryIndexer[] = [];
afterEach(async () => { await Promise.allSettled(owners.splice(0).map(owner => owner.close())); vi.useRealTimers(); });
function setup(storePatch: Partial<RunHistoryStore> = {}, read: RunHistoryMetricReader['readRunHistorySummary'] = vi.fn(async (): Promise<RunHistoryProjection> => ({ ...pendingRunHistoryMetrics(), availability: 'unavailable' }))) {
  vi.useFakeTimers({ toFake: ['Date', 'performance', 'setTimeout', 'clearTimeout'] });
  const scan = vi.fn(async () => [job]); const defer = vi.fn(async () => null); const commit = vi.fn(async (request: Parameters<RunHistoryStore['commit']>[0]) => request.summary);
  const onFailure = vi.fn(async () => undefined);
  const owner = startRunHistoryIndexer({ store: { scan, defer, commit, ...storePatch }, metrics: { readRunHistorySummary: read }, onFailure }); owners.push(owner);
  return { owner, scan, defer, commit, read, onFailure };
}
it('expires independently during a held scan, retains admission/close, and ignores late success', async () => {
  const held = deferred<RunHistoryJob[]>(); const scan = vi.fn(() => held.promise); const f = setup({ scan });
  await vi.advanceTimersByTimeAsync(0); expect(scan).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(45000); expect(f.owner.state()).toEqual({ status: 'failed', active: true, problem: 'deadline' });
  expect(f.onFailure).toHaveBeenCalledWith('deadline'); let closed = false; const closing = f.owner.close().finally(() => { closed = true; });
  const rejected = expect(closing).rejects.toThrow('History indexing deadline');
  await vi.advanceTimersByTimeAsync(1000); expect(closed).toBe(false); expect(scan).toHaveBeenCalledTimes(1);
  held.resolve([job]); await rejected; expect(f.read).not.toHaveBeenCalled(); expect(f.commit).not.toHaveBeenCalled(); expect(f.owner.state().active).toBe(false);
});
it('keeps a held commit original after expiry without replaying or accepting its late acknowledgement', async () => {
  const held = deferred<Awaited<ReturnType<RunHistoryStore['commit']>>>(); const commit = vi.fn<RunHistoryStore['commit']>(() => held.promise); const f = setup({ commit });
  await vi.advanceTimersByTimeAsync(0); expect(commit).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(45000); expect(f.owner.state()).toMatchObject({ status: 'failed', active: true, problem: 'deadline' });
  const closing = f.owner.close(); const rejected = expect(closing).rejects.toThrow('History indexing deadline');
  held.resolve(commit.mock.calls[0]![0].summary); await rejected; expect(commit).toHaveBeenCalledTimes(1); expect(f.scan).toHaveBeenCalledTimes(1);
});
it('aborts but drains an ignored-abort metric original through explicit close', async () => {
  const held = deferred<RunHistoryProjection>(); const read = vi.fn<RunHistoryMetricReader['readRunHistorySummary']>(() => held.promise); const f = setup({}, read);
  await vi.advanceTimersByTimeAsync(0); let closed = false; const closing = f.owner.close().then(() => { closed = true; });
  expect(read.mock.calls[0]![1].signal.aborted).toBe(true); await vi.advanceTimersByTimeAsync(1000); expect(closed).toBe(false);
  held.resolve({ ...pendingRunHistoryMetrics(), availability: 'unavailable' }); await closing;
  expect(f.commit).not.toHaveBeenCalled(); expect(f.onFailure).not.toHaveBeenCalled(); expect(f.owner.state()).toEqual({ status: 'closed', active: false, problem: null });
});
it('defers the same pending/busy subject without an unbounded discovery queue or execution', async () => {
  const read: RunHistoryMetricReader['readRunHistorySummary'] = vi.fn(async (): Promise<RunHistoryProjection> => { throw new MetricReadError('busy'); }); const f = setup({}, read);
  const now = Date.now(); await vi.advanceTimersByTimeAsync(0);
  expect(f.scan).toHaveBeenCalledWith({ nowMs: now, limit: 1 }); expect(f.defer).toHaveBeenCalledWith({ job, dueMs: now + 1000 }); expect(f.commit).not.toHaveBeenCalled();
  expect(f.owner.state()).toMatchObject({ status: 'running', active: false, problem: null });
});
it('persists known unavailable evidence while surfacing unexpected metadata failures', async () => {
  const error = new Error('Synthetic durable store failed'); const f = setup({ commit: async () => { throw error; } });
  await vi.advanceTimersByTimeAsync(0); expect(f.owner.state()).toMatchObject({ status: 'failed', active: false, problem: 'operation' });
  expect(f.onFailure).toHaveBeenCalledTimes(1); await expect(f.owner.close()).rejects.toBe(error);
});
it('still reports whole-turn expiry after explicit close while an original ignores abort', async () => {
  const held = deferred<RunHistoryJob[]>(); const f = setup({ scan: () => held.promise });
  await vi.advanceTimersByTimeAsync(0); const closing = f.owner.close();
  const rejected = expect(closing).rejects.toThrow('History indexing deadline');
  await vi.advanceTimersByTimeAsync(45000);
  expect(f.owner.state()).toEqual({ status: 'failed', active: true, problem: 'deadline' }); expect(f.onFailure).toHaveBeenCalledTimes(1);
  held.resolve([]); await rejected; expect(f.read).not.toHaveBeenCalled(); expect(f.commit).not.toHaveBeenCalled();
});
it.each([undefined, null, false, 0])('preserves a falsy indexing failure through close: %s', async reason => {
  const f = setup({ commit: async () => { throw reason; } });
  await vi.advanceTimersByTimeAsync(0);
  expect(f.owner.state()).toMatchObject({ status: 'failed', problem: 'operation' });
  await expect(f.owner.close()).rejects.toBe(reason);
});
