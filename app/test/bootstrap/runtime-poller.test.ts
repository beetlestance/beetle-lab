import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startRuntimePoller } from '../../src/bootstrap/runtime-poller.js';
import type { RuntimePoller, RuntimePublisher } from '../../src/bootstrap/runtime-poller.js';
import type { CapacitySource, RuntimeObservation } from '../../src/ports/runtime.js';
import { settingsFixture } from '../domain/fixtures.js';

function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const value = (at = 100): RuntimeObservation => ({ journalAuthority: '33333333-3333-4333-8333-333333333333', execution: { stagingBytes: 10485760, perRunStagingBytes: 2097152 }, ceilings: settingsFixture().runtime, observedAtMs: at, expiresAtMs: at + 1000 });
const flush = async () => { for (let turn = 0; turn < 16; turn++) await Promise.resolve(); };
const handles: RuntimePoller[] = [];
function fixture(sample = vi.fn<CapacitySource['sample']>().mockResolvedValue(null),
  publish = vi.fn<RuntimePublisher>().mockResolvedValue(true), close = vi.fn<CapacitySource['close']>().mockResolvedValue()) {
  const source: CapacitySource = { sample, close };
  const poller = startRuntimePoller({ source, publish }); handles.push(poller);
  return { source, sample, publish, close, poller };
}
beforeEach(() => { vi.useFakeTimers(); });
afterEach(async () => { await Promise.allSettled(handles.splice(0).map(handle => handle.close())); vi.clearAllTimers(); vi.useRealTimers(); });

describe('original capacity publication loop', () => {
  it('does not write repeated initial unknown facts or renew a refusal fence', async () => {
    const f = fixture(); await vi.advanceTimersByTimeAsync(1000);
    expect(f.sample).toHaveBeenCalledTimes(5); expect(f.publish).not.toHaveBeenCalled();
    expect(f.poller.state()).toEqual({ status: 'unknown', sampling: false, reason: 'unavailable' });
  });
  it('revokes known capacity exactly once across an unknown period then recovers', async () => {
    const sample = vi.fn<CapacitySource['sample']>().mockResolvedValue(null).mockResolvedValueOnce(value());
    const f = fixture(sample); await flush(); expect(f.poller.state().status).toBe('published');
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.publish.mock.calls.map(call => call[0])).toEqual([value(), null]);
    sample.mockResolvedValue(value(2000)); await vi.advanceTimersByTimeAsync(250);
    expect(f.poller.state().status).toBe('published'); expect(f.publish).toHaveBeenCalledTimes(3);
  });
  it('keeps old-source refusals visible without writing null repeatedly and accepts a newer source', async () => {
    const publish = vi.fn<RuntimePublisher>().mockResolvedValue(false);
    const f = fixture(vi.fn<CapacitySource['sample']>().mockResolvedValue(value()), publish);
    await vi.advanceTimersByTimeAsync(750);
    expect(publish).toHaveBeenCalledTimes(4); expect(publish.mock.calls.every(([fact]) => fact !== null)).toBe(true);
    expect(f.poller.state()).toMatchObject({ status: 'unknown', reason: 'observation_rejected' });
    f.sample.mockResolvedValue(value(2000)); publish.mockResolvedValue(true);
    await vi.advanceTimersByTimeAsync(250); expect(f.poller.state().status).toBe('published');
  });
  it('revokes a prior accepted fact when a new observation is refused', async () => {
    const publish = vi.fn<RuntimePublisher>().mockResolvedValue(true).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const f = fixture(vi.fn<CapacitySource['sample']>().mockResolvedValue(value()), publish);
    await vi.advanceTimersByTimeAsync(250);
    expect(publish.mock.calls.map(([fact]) => fact)).toEqual([value(), value(), null]);
    expect(f.poller.state()).toMatchObject({ status: 'unknown', reason: 'observation_rejected' });
  });
  it('retains a slow original sample without overlapping or scheduling new work', async () => {
    const held = deferred<RuntimeObservation | null>();
    const f = fixture(vi.fn<CapacitySource['sample']>().mockReturnValue(held.promise));
    await vi.advanceTimersByTimeAsync(5000); expect(f.sample).toHaveBeenCalledTimes(1);
    let closed = false; const closing = f.poller.close().then(() => { closed = true; });
    await flush(); expect(f.sample.mock.calls[0]![0]!.aborted).toBe(true); expect(closed).toBe(false);
    held.resolve(value()); await closing; expect(f.publish).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000); expect(f.sample).toHaveBeenCalledTimes(1);
  });
  it('owns an original publication after close and schedules from settlement', async () => {
    const held = deferred<boolean>();
    const f = fixture(vi.fn<CapacitySource['sample']>().mockResolvedValue(value()), vi.fn<RuntimePublisher>().mockReturnValue(held.promise));
    await vi.advanceTimersByTimeAsync(2000); expect(f.sample).toHaveBeenCalledTimes(1);
    const closing = f.poller.close(); let closed = false; void closing.then(() => { closed = true; });
    await flush(); expect(closed).toBe(false); held.resolve(true); await closing;
    expect(f.poller.state().status).toBe('closed'); expect(vi.getTimerCount()).toBe(0);
  });
  it('waits for original source close and returns the same shutdown promise', async () => {
    const held = deferred<void>(); const f = fixture(undefined, undefined, vi.fn().mockReturnValue(held.promise));
    const closing = f.poller.close(); expect(f.poller.close()).toBe(closing);
    let done = false; void closing.then(() => { done = true; }); await flush(); expect(done).toBe(false);
    held.resolve(); await closing; expect(f.sample).not.toHaveBeenCalled();
  });
  it('captures a bounded immutable private observation before awaiting publication', async () => {
    const original = value(); const held = deferred<boolean>();
    const f = fixture(vi.fn<CapacitySource['sample']>().mockResolvedValue(original), vi.fn<RuntimePublisher>().mockReturnValue(held.promise));
    await flush(); const sent = f.publish.mock.calls[0]![0]!;
    original.ceilings.pool.cpuMillis = 1; original.observedAtMs = 999;
    expect(sent).toEqual(value()); expect(Object.isFrozen(sent.ceilings.pool)).toBe(true);
    held.resolve(true); await flush();
  });
  it('does not create known publication after reentrant close inside sampling', async () => {
    const sample = vi.fn<CapacitySource['sample']>().mockImplementation(async () => { void f.poller.close(); return value(); });
    const f = fixture(sample); await flush(); await f.poller.close();
    expect(f.publish).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it('captures source methods once rather than following caller mutation', async () => {
    const f = fixture(); f.source.sample = async () => value(); f.source.close = async () => { throw new Error('replacement'); };
    await flush(); expect(f.sample).toHaveBeenCalledTimes(1); expect(f.publish).not.toHaveBeenCalled();
    await f.poller.close(); expect(f.close).toHaveBeenCalledTimes(1);
  });
  it('fences ticks on publication exception and preserves original failure through close', async () => {
    const error = new Error('synthetic original');
    const f = fixture(vi.fn<CapacitySource['sample']>().mockResolvedValue(value()), vi.fn<RuntimePublisher>().mockRejectedValue(error));
    await vi.advanceTimersByTimeAsync(5000); expect(f.sample).toHaveBeenCalledTimes(1);
    expect(f.poller.state()).toMatchObject({ status: 'failed', reason: 'publication_failure' });
    await expect(f.poller.close()).rejects.toBe(error);
  });
  it('revokes on unexpected source failure and retains both failure causes', async () => {
    const error = new Error('source'); const revocation = new Error('publication');
    const sample = vi.fn<CapacitySource['sample']>().mockResolvedValueOnce(value()).mockRejectedValue(error);
    const publish = vi.fn<RuntimePublisher>().mockResolvedValueOnce(true).mockRejectedValue(revocation);
    const f = fixture(sample, publish); await vi.advanceTimersByTimeAsync(250);
    expect(publish.mock.calls[1]![0]).toBeNull(); expect(f.poller.state().status).toBe('failed');
    await expect(f.poller.close()).rejects.toMatchObject({ errors: [error, revocation] });
  });
  it('preserves source close rejection, including repeated close', async () => {
    const error = new Error('close'); const f = fixture(undefined, undefined, vi.fn().mockRejectedValue(error));
    const closing = f.poller.close(); await expect(closing).rejects.toBe(error); expect(f.poller.close()).toBe(closing);
  });
  it('rejects failed revocation', async () => {
    const sample = vi.fn<CapacitySource['sample']>().mockResolvedValueOnce(value()).mockResolvedValue(null);
    const f = fixture(sample, vi.fn<RuntimePublisher>().mockResolvedValueOnce(true).mockResolvedValue(false));
    await vi.advanceTimersByTimeAsync(250); expect(f.poller.state().status).toBe('failed');
    await expect(f.poller.close()).rejects.toThrow('revocation refused');
  });
  it('fences invalid foreign acknowledgements and oversized observations', async () => {
    const invalid = fixture(vi.fn<CapacitySource['sample']>().mockResolvedValue(value()),
      vi.fn<RuntimePublisher>().mockResolvedValue(undefined as unknown as boolean));
    await flush(); expect(invalid.poller.state().status).toBe('failed');
    await expect(invalid.poller.close()).rejects.toThrow('Invalid runtime publication');
    const oversized = { ...value(), extra: 'x'.repeat(65537) };
    const large = fixture(vi.fn<CapacitySource['sample']>().mockResolvedValue(oversized));
    await flush(); expect(large.publish).not.toHaveBeenCalled(); expect(large.poller.state().status).toBe('failed');
    await expect(large.poller.close()).rejects.toThrow();
  });
  it.each([0, 24, 60001, 1.5, NaN])('rejects invalid interval %s before sampling', intervalMs => {
    const source: CapacitySource = { sample: vi.fn(), close: vi.fn() };
    expect(() => startRuntimePoller({ source, publish: vi.fn(), intervalMs })).toThrow();
    expect(source.sample).not.toHaveBeenCalled();
  });
});
