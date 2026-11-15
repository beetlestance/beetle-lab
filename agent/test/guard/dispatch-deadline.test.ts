import {afterEach, expect, it, vi} from 'vitest';
import {performance} from 'node:perf_hooks';
import {OutputGuardService} from '../../src/guard/service.js';
import {scanOutput} from '../../src/staging/output-scan.js';
import {OutputTree} from '../../src/staging/output-tree.js';
import {scanBudget} from '../../src/staging/output-budget.js';
import {outputFixture} from '../staging/output-fixtures.js';
import {deferred, flush} from './fixtures.js';
const fixtures = outputFixture();
afterEach(() => {vi.restoreAllMocks(); vi.useRealTimers();});
it('does not mistake a deferred expired sample for malformed input or renew its freshness', async () => {
  const fixture = await fixtures.prepared();
  vi.useFakeTimers(); vi.spyOn(performance, 'now').mockImplementation(() => Date.now()); vi.setSystemTime(0);
  const held = deferred<void>(); const stop = vi.fn(async () => undefined); let calls = 0;
  const read = vi.spyOn(OutputTree.prototype, 'read');
  const service = new OutputGuardService({root: fixture.options.root, minimumFreeBytes: 0,
    intervalMs: 50, ttlMs: 200, sampleTimeoutMs: 100, monotonicNow: () => performance.now(), stop}, async (request, operation) => {
    if (++calls === 2) await held.promise;
    return scanOutput(fixture.options.root, request, operation);
  });
  try {
    const watch = service.watch(fixture.request); service.start();
    expect(await watch.initial).toEqual({ready: true});
    expect(watch.status().lastKnownAt).toBe(0); read.mockClear();
    await vi.advanceTimersByTimeAsync(50); expect(calls).toBe(2);
    // A queued original starts late, before the independent freshness TTL expires.
    vi.setSystemTime(151); held.resolve(); await flush();
    expect(read).not.toHaveBeenCalled(); expect(stop).not.toHaveBeenCalled();
    expect(watch.status()).toMatchObject({ready: true, lastKnownAt: 0});
    vi.setSystemTime(200); expect(watch.status().ready).toBe(false);
    await flush(); expect(stop).toHaveBeenCalledExactlyOnceWith(fixture.request.key, 'artifact_incomplete');
  } finally {held.resolve(); await service.close();}
});
it('keeps malformed and excessive future scan deadlines invalid', () => {
  vi.spyOn(performance, 'now').mockReturnValue(100);
  for (const deadline of [-1, NaN, Infinity, 30101]) expect(() => scanBudget({deadline})).toThrow('invalid_input');
  const getter = vi.fn();
  expect(() => scanBudget(Object.defineProperty({}, 'deadline', {get: getter}) as {deadline: number})).toThrow('invalid_input');
  expect(getter).not.toHaveBeenCalled();
});
