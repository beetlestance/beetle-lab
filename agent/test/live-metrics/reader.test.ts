import { expect, it } from 'vitest';
import { LiveMetricReader } from '../../src/live-metrics/index.js';
import type { MailboxArchiveReply } from '../../src/backends/docker/index.js';
import { deferred, fixture, frame, hash, image } from './fixtures.js';
import { liveMetricSubsetText } from '@beetle/contracts/api';
it('accepts matching frames while unchanged polls preserve the producer freshness', async () => {
  const f = fixture(); expect(await f.reader.read(f.operation())).toEqual({ok: true, frame: f.initial});
  f.clock(7000); expect((await f.reader.read(f.operation())).ok).toBe(true);
  f.clock(7001); expect(await f.reader.read(f.operation())).toEqual({ok: false, reason: 'stale'}); await f.reader.close();
});
it.each(['scope', 'epoch', 'subset'] as const)('rejects a self-declared %s outside trusted approval', async mismatch => {
  const f = fixture(); let value = frame();
  if (mismatch === 'scope') value = frame({scope: {...value.scope, generation: 2}});
  if (mismatch === 'epoch') value = frame({producerEpoch: '00000000-0000-4000-8000-000000000005'});
  if (mismatch === 'subset') {
    const subset = {...value.subset, excludedSeries: 1}; value = frame({subset, subsetDigest: hash(liveMetricSubsetText(subset))});
  }
  f.set({ok: true, status: 200, image: image(value)});
  expect(await f.reader.read(f.operation())).toEqual({ok: false, reason: mismatch}); await f.reader.close();
});
it('rejects altered repeated revisions and regressing source windows', async () => {
  const f = fixture(); expect((await f.reader.read(f.operation())).ok).toBe(true);
  f.set({ok: true, status: 200, image: image(frame({capturedAtMs: 999}))});
  expect(await f.reader.read(f.operation())).toEqual({ok: false, reason: 'ordering'});
  const next = frame({publishedSequence: 2, sourceSequence: 2, startTimeMs: 1000, endTimeMs: 2000, capturedAtMs: 2000, publishedAtMs: 2000});
  f.clock(2000); f.set({ok: true, status: 200, image: image(next)}); expect((await f.reader.read(f.operation())).ok).toBe(true);
  f.set({ok: true, status: 200, image: image(f.initial)}); expect(await f.reader.read(f.operation())).toEqual({ok: false, reason: 'ordering'});
  await f.reader.close();
});
it('retains a cancelled read and cleanup until the actual port original settles', async () => {
  const f = fixture(); const held = deferred<MailboxArchiveReply>(); const issued = deferred<void>(); let signal!: AbortSignal;
  f.port(async operation => {signal = operation.signal!; issued.resolve(); return held.promise;});
  const pending = f.reader.read(f.operation()); await issued.promise;
  expect(await f.reader.read(f.operation())).toEqual({ok: false, reason: 'busy'});
  const closing = f.reader.close(); expect(f.reader.close()).toBe(closing); expect(signal.aborted).toBe(true);
  let done = false; void closing.then(() => {done = true;}); await Promise.resolve(); expect(done).toBe(false);
  held.resolve({ok: true, status: 200, image: image(f.initial)});
  expect(await pending).toEqual({ok: false, reason: 'closed'}); await closing;
  expect(await f.reader.read(f.operation())).toEqual({ok: false, reason: 'closed'});
});
it('prevents dispatch after same-turn close and invalid, aborted or expired preflight', async () => {
  const f = fixture(); const controller = new AbortController(); controller.abort();
  expect(await f.reader.read({deadline: NaN})).toEqual({ok: false, reason: 'invalid_input'});
  expect(await f.reader.read({deadline: 5000, signal: controller.signal})).toEqual({ok: false, reason: 'aborted'});
  expect(await f.reader.read({deadline: 0})).toEqual({ok: false, reason: 'deadline'});
  const pending = f.reader.read(f.operation()); await f.reader.close(); expect(await pending).toEqual({ok: false, reason: 'closed'});
  expect(f.calls()).toBe(0);
});
it('caps the port deadline and rejects late or regressing-clock completions', async () => {
  const f = fixture(); f.port(async operation => {
    expect(operation.deadline).toBe(5000); f.clock(1000, 5000); return {ok: true, status: 200, image: image(f.initial)};
  });
  expect(await f.reader.read({deadline: 100000})).toEqual({ok: false, reason: 'deadline'});
  f.clock(1000, 0); expect(await f.reader.read(f.operation())).toEqual({ok: false, reason: 'clock'}); await f.reader.close();
});
it('rejects invalid native images and revision/body disagreement without retry', async () => {
  const f = fixture(); f.set({ok: true, status: 200, image: new Uint8Array(65792)});
  expect(await f.reader.read(f.operation())).toEqual({ok: false, reason: 'unavailable'});
  f.set({ok: true, status: 200, image: image(f.initial, 2)});
  expect(await f.reader.read(f.operation())).toEqual({ok: false, reason: 'unavailable'});
  expect(f.calls()).toBe(2); await f.reader.close();
});
it('captures approval before any external mutation and rejects malformed approval before IO', async () => {
  const value = frame(); let calls = 0; const approval = {scope: {...value.scope}, producerEpoch: value.producerEpoch, subset: structuredClone(value.subset)};
  const reader = new LiveMetricReader({approval, clock: {wall: () => 1000, monotonic: () => 0}, read: async () => {calls++; return {ok: true, status: 200, image: image(value)};}});
  approval.scope.generation = 2; approval.subset.selected[0]!.metric = 'foreign';
  expect((await reader.read({deadline: 5000})).ok).toBe(true); await reader.close();
  expect(() => new LiveMetricReader({approval: {...approval, producerEpoch: 'invalid'}, read: async () => {calls++; return {ok: true, status: 404, image: null};}})).toThrow();
  expect(calls).toBe(1);
});

it('rejects overlapping source windows despite advancing publication ordinals', async () => {
  const f = fixture(); expect((await f.reader.read(f.operation())).ok).toBe(true);
  f.clock(1500); f.set({ok: true, status: 200, image: image(frame({publishedSequence: 2, sourceSequence: 2,
    startTimeMs: 500, endTimeMs: 1500, capturedAtMs: 1500, publishedAtMs: 1500}))});
  expect(await f.reader.read(f.operation())).toEqual({ok: false, reason: 'ordering'}); await f.reader.close();
});
it.each([
  {startTimeMs: 0, endTimeMs: 1000, capturedAtMs: 1000, publishedAtMs: 8000},
  {startTimeMs: 0, endTimeMs: 1000, capturedAtMs: 8000, publishedAtMs: 8000},
])('rejects newly published data when capture or source is already stale', async patch => {
  const f = fixture(); f.clock(8000); f.set({ok: true, status: 200, image: image(frame(patch))});
  expect(await f.reader.read(f.operation())).toEqual({ok: false, reason: 'stale'}); await f.reader.close();
});
it('expires an unchanged frame monotonically even if the wall clock freezes', async () => {
  const f = fixture(); expect((await f.reader.read(f.operation())).ok).toBe(true);
  f.clock(1000, 6001); expect(await f.reader.read(f.operation())).toEqual({ok: false, reason: 'stale'}); await f.reader.close();
});
