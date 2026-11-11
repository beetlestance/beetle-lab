import { afterEach, expect, it, vi } from 'vitest';
import { RunReadGate } from './read-gate.js';
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(accept => { resolve = accept; }); return { promise, resolve }; };
afterEach(() => vi.useRealTimers());
it('serializes competing panel reads and retains admission until the original settles after abort', async () => {
  const gate = new RunReadGate(); const original = deferred(); const first = new AbortController();
  const next = vi.fn(async () => 'next');
  const active = gate.run(first.signal, () => original.promise); const waiting = gate.run(undefined, next);
  first.abort(); await Promise.resolve(); expect(next).not.toHaveBeenCalled();
  original.resolve(); await active; expect(await waiting).toBe('next'); expect(next).toHaveBeenCalledTimes(1);
});
it('bounds waiting intents, removes canceled work and expires admission without issuing requests', async () => {
  vi.useFakeTimers(); const gate = new RunReadGate(); const original = deferred(); const work = vi.fn(async () => 1);
  const active = gate.run(undefined, () => original.promise); const cancel = new AbortController();
  const queued = [gate.run(cancel.signal, work), ...Array.from({length: 3}, () => gate.run(undefined, work))];
  const results = Promise.allSettled(queued);
  await expect(gate.run(undefined, work)).rejects.toThrow('capacity'); cancel.abort();
  await vi.advanceTimersByTimeAsync(5000); expect((await results).every(result => result.status === 'rejected')).toBe(true);
  original.resolve(); await active; expect(work).not.toHaveBeenCalled(); gate.close();
});
it('retirement rejects queued reads and future calls while preserving original ownership', async () => {
  const gate = new RunReadGate(); const original = deferred(); const work = vi.fn(async () => 1);
  const active = gate.run(undefined, () => original.promise); const waiting = gate.run(undefined, work);
  const rejected = expect(waiting).rejects.toThrow('retired'); gate.close(); await rejected;
  await expect(gate.run(undefined, work)).rejects.toThrow('retired'); original.resolve(); await active;
  expect(work).not.toHaveBeenCalled();
});
it('surfaces original failures without retrying and admits the next read', async () => {
  const gate = new RunReadGate(); const work = vi.fn(async () => { throw new Error('read failed'); });
  const failed = gate.run(undefined, work); const next = gate.run(undefined, async () => 2);
  await expect(failed).rejects.toThrow('read failed'); expect(await next).toBe(2); expect(work).toHaveBeenCalledTimes(1);
});
