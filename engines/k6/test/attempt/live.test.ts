import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { captureMailboxImage, MAILBOX_BYTES } from '@beetle/contracts/live-mailbox';
import { decodeLiveMetricSnapshot } from '@beetle/contracts/api';
import { createK6MetricProfile } from '../../aggregation/index.js';
import { AttemptLive, attemptLiveSubset } from '../../wrapper/attempt/live.js';
import { NativeMailboxError } from '../../wrapper/live-mailbox/index.js';
import { liveInput, MemoryMailbox, deferred } from './live-fixtures.js';
const hash = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
afterEach(() => {vi.useRealTimers();});
it('derives a bounded immutable subset only from the approved parser catalogue', () => {
  const input = liveInput(); const subset = attemptLiveSubset(input.suite); const profile = createK6MetricProfile(input.suite);
  expect(subset.selected).toHaveLength(Math.min(20, profile.allowedSeries.length));
  expect(subset.excludedSeries).toBe(profile.allowedSeries.length - subset.selected.length);
  subset.selected.forEach(({ordinal, ...row}, index) => {
    expect(ordinal).toBe(index); expect(profile.allowedSeries).toContainEqual(row);
  });
  expect(subset.selected.map(row => row.metric)).toEqual(expect.arrayContaining(['http_req_duration', 'http_req_failed', 'vus', 'dropped_iterations']));
  expect(Object.isFrozen(subset.selected)).toBe(true);
});
it('publishes an actual mailbox frame and charges extent plus every physical write', async () => {
  vi.useFakeTimers(); const input = liveInput(); const file = new MemoryMailbox(); const live = new AttemptLive();
  await live.start(input, async () => file);
  live.accept({startTimeMs: 0, endTimeMs: 1000, series: []}); await vi.advanceTimersByTimeAsync(0);
  const image = captureMailboxImage(file.bytes, hash); const frame = decodeLiveMetricSnapshot(image.frame, hash);
  expect(frame.scope).toEqual(input.scope); expect(frame.subset).toEqual(attemptLiveSubset(input.suite));
  expect(frame.publishedSequence).toBe(image.revision); expect(frame.series).toEqual([]);
  const state = await live.close(); expect(state.quiescence).toBe('confirmed'); expect(file.closes).toBe(1);
  expect(state.producedBytes).toBe(MAILBOX_BYTES + file.produced); expect(state.producedBytes).toBeLessThanOrEqual(input.maximumBytes);
});
it('drains a held write and descriptor close before confirming cleanup', async () => {
  vi.useFakeTimers(); const file = new MemoryMailbox(); const write = deferred(); const close = deferred();
  file.writeGate = write.promise; file.closeGate = close.promise; const live = new AttemptLive();
  await live.start(liveInput(), async () => file); live.accept({startTimeMs: 0, endTimeMs: 1000, series: []});
  await vi.advanceTimersByTimeAsync(0); await file.firstWrite.promise;
  const closing = live.close(); expect(live.close()).toBe(closing); let done = false; void closing.then(() => {done = true;});
  await Promise.resolve(); expect(done).toBe(false); write.resolve();
  for (let index = 0; index < 40; index++) await Promise.resolve();
  expect(done).toBe(false); close.resolve(); expect((await closing).quiescence).toBe('confirmed');
});
it('retains startup originals when close arrives while native open is pending', async () => {
  const gate = deferred(); const file = new MemoryMailbox(); const live = new AttemptLive(); const issued = deferred();
  const starting = live.start(liveInput(), async () => {issued.resolve(); await gate.promise; return file;}); await issued.promise;
  const closing = live.close(); let done = false; void closing.then(() => {done = true;});
  await Promise.resolve(); expect(done).toBe(false); gate.resolve(); await starting;
  expect((await closing).quiescence).toBe('confirmed'); expect(file.closes).toBe(1); expect(file.produced).toBe(0);
});
it('fences startup before native effects when stopped in the same turn', async () => {
  const live = new AttemptLive(); const open = vi.fn(async () => new MemoryMailbox());
  const starting = live.start(liveInput(), open); await live.close(); await starting; expect(open).not.toHaveBeenCalled();
});
it('reports safe unavailable setup separately from failed original cleanup', async () => {
  const live = new AttemptLive(); await live.start(liveInput(), async () => {throw new Error('private path');});
  expect(await live.close()).toMatchObject({status: 'unavailable', reason: 'setup', quiescence: 'confirmed'});
  const retained = new MemoryMailbox(); const failed = new AttemptLive();
  await failed.start(liveInput(), async () => {throw new NativeMailboxError('cleanup', retained);});
  expect(await failed.close()).toMatchObject({status: 'unavailable', reason: 'cleanup', quiescence: 'failed'});
});

it('retains the same startup completion and refuses already-aborted startup effects', async () => {
  const live = new AttemptLive(); const gate = deferred(); const file = new MemoryMailbox();
  const input = liveInput(); const open = vi.fn(async () => {await gate.promise; return file;});
  const starting = live.start(input, open); expect(live.start(input, open)).toBe(starting);
  gate.resolve(); await starting; await live.close();
  const controller = new AbortController(); controller.abort(); const stopped = new AttemptLive();
  const abortedOpen = vi.fn(async () => new MemoryMailbox());
  await stopped.start({...input, signal: controller.signal}, abortedOpen); expect(abortedOpen).not.toHaveBeenCalled();
});
