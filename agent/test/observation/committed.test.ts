import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { encodeJson } from '@beetle/contracts';
import type { AdmissionValue } from '../../src/admission/index.js';
import type { ObservationPublisher, PublisherOptions } from '../../src/observation/index.js';
import { observation } from '../admission/fixtures.js';
import { hold, settle, setup } from './publisher-fixtures.js';

const owners: { publisher: ObservationPublisher; failed: boolean }[] = [];
function fixture(options: Partial<PublisherOptions> = {}, failed = false) {
  const f = setup(options); owners.push({ publisher: f.publisher, failed }); return f;
}
beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
  try {
    await Promise.all(owners.splice(0).map(async owner => {
      if (owner.failed) await expect(owner.publisher.close()).rejects.toMatchObject({ reason: 'cleanup' });
      else await owner.publisher.close();
    }));
  } finally { vi.useRealTimers(); }
});

it('exposes only an acknowledged immutable frame with original sample start and expiry', async () => {
  const f = fixture(); const held = hold<AdmissionValue>(); const raw = observation(100005);
  f.sample.mockImplementationOnce(async () => { f.clock.wall += 5; f.clock.mono += 5; return raw; });
  f.admission.mockImplementationOnce(async () => held.promise);
  expect(f.publisher.snapshot()).toBeNull(); expect(f.sample).not.toHaveBeenCalled();
  f.publisher.start(); await settle();
  try {
    expect(f.publisher.snapshot()).toBeNull();
    f.clock.wall += 15; f.clock.mono += 15;
    expect(f.publisher.snapshot()).toBeNull();
  } finally { held.resolve({ stored: true }); }
  await settle();
  const frame = f.publisher.snapshot();
  expect(frame).toMatchObject({ sampleStartedAtMs: 100000, expiresAtMs: 100100,
    observation: { observedAt: 100005, guards: { source: 'supervisor', observedAt: 100005, controls: ['timeout', 'output'] } } });
  if (!frame) throw new Error('Missing committed frame');
  const cpu = frame.observation.capacity.cpuMillis; raw.capacity.cpuMillis = 9999;
  expect(frame.observation.capacity.cpuMillis).toBe(cpu);
  for (const value of [frame, frame.observation, frame.observation.capacity, frame.observation.controls, frame.observation.guards?.controls]) {
    expect(Object.isFrozen(value)).toBe(true);
  }
  expect(Reflect.set(frame.observation.capacity, 'cpuMillis', 1)).toBe(false);
  expect(f.publisher.snapshot()).toBe(frame);
  expect(f.sample).toHaveBeenCalledOnce();
});

it('retains the previous committed view until a newer original write is acknowledged', async () => {
  const f = fixture(); f.publisher.start(); await settle();
  const original = f.publisher.snapshot(); const held = hold<AdmissionValue>();
  f.admission.mockImplementationOnce(async () => held.promise);
  f.sample.mockImplementationOnce(async () => ({ ...observation(f.clock.wall), source: 'new-resource-source' }));
  await f.tick();
  try {
    expect(f.publisher.status()).toMatchObject({ publishing: true, ready: true });
    expect(f.publisher.snapshot()).toBe(original);
  } finally { held.resolve({ stored: true }); }
  await settle();
  expect(f.publisher.snapshot()).toMatchObject({ sampleStartedAtMs: 100010, expiresAtMs: 100110,
    observation: { source: 'new-resource-source' } });
  expect(f.publisher.snapshot()).not.toBe(original);
});

it.each(['monotonic', 'wall', 'rollback', 'guard', 'close'] as const)('revokes the committed view on %s without sampling on reads', async cause => {
  const f = fixture(); f.publisher.start(); await settle(); expect(f.publisher.snapshot()).not.toBeNull();
  const calls = f.sample.mock.calls.length;
  if (cause === 'monotonic') f.clock.mono += 100;
  if (cause === 'wall') f.clock.wall += 100;
  if (cause === 'rollback') f.clock.wall--;
  if (cause === 'guard') f.guards.timeout = false;
  if (cause === 'close') await f.publisher.close();
  expect(f.publisher.snapshot()).toBeNull(); expect(f.publisher.status().ready).toBe(false);
  expect(f.sample).toHaveBeenCalledTimes(calls);
});

it('cannot restore an invalidated frame from a late successful acknowledgement', async () => {
  const f = fixture(); const held = hold<AdmissionValue>();
  f.admission.mockImplementationOnce(async () => held.promise); f.publisher.start(); await settle();
  try { f.guards.output = false; expect(f.publisher.snapshot()).toBeNull(); }
  finally { held.resolve({ stored: true }); }
  await settle(); expect(f.publisher.snapshot()).toBeNull();
  f.guards.output = true;
  await vi.advanceTimersByTimeAsync(10); expect(f.publisher.snapshot()).toBeNull();
  await f.tick(); expect(f.publisher.snapshot()).not.toBeNull();
});

it('keeps close attached to a held original write and never exposes its late frame', async () => {
  const f = fixture(); const held = hold<AdmissionValue>();
  f.admission.mockImplementationOnce(async () => held.promise); f.publisher.start(); await settle();
  const closing = f.publisher.close(); let done = false; void closing.then(() => { done = true; });
  try { await settle(); expect(done).toBe(false); expect(f.publisher.snapshot()).toBeNull(); }
  finally { held.resolve({ stored: true }); }
  await closing; expect(f.publisher.snapshot()).toBeNull();
});

it.each(['wall', 'monotonic'] as const)('refuses an initial acknowledgement after the original %s lease expires', async clock => {
  const f = fixture(); const held = hold<AdmissionValue>();
  f.admission.mockImplementationOnce(async () => held.promise); f.publisher.start(); await settle();
  try {
    if (clock === 'wall') f.clock.wall += 100;
    else f.clock.mono += 100;
    expect(f.publisher.snapshot()).toBeNull();
  } finally { held.resolve({ stored: true }); }
  await settle(); expect(f.publisher.snapshot()).toBeNull(); expect(f.publisher.status().ready).toBe(false);
});

it('refuses stored:false until a newer sample is committed', async () => {
  const f = fixture(); f.admission.mockResolvedValueOnce({ stored: false });
  f.publisher.start(); await settle(); expect(f.publisher.snapshot()).toBeNull();
  await f.tick(); expect(f.publisher.snapshot()).not.toBeNull();
});

it('refuses guard callbacks re-entering the read', async () => {
  let nested: unknown = 'not-called';
  let inspect = false;
  const current: ReturnType<typeof fixture> = fixture({ output: { status: () => {
    if (inspect) nested = current.publisher.snapshot();
    return { ready: true, running: true, closed: false, watched: 0 };
  } } });
  current.publisher.start(); await settle(); inspect = true;
  expect(current.publisher.snapshot()).not.toBeNull(); expect(nested).toBeNull();
});

it.each(['size', 'expiry'] as const)('rejects a final %s bound before issuing a known write', async limit => {
  const f = fixture({}, true);
  if (limit === 'size') {
    const raw = observation(f.clock.wall);
    raw.source += 'x'.repeat(16_384 - Buffer.byteLength(encodeJson(raw, 32768)));
    expect(Buffer.byteLength(encodeJson(raw, 32768))).toBe(16_384);
    f.sample.mockResolvedValueOnce(raw);
  } else f.clock.wall = 8_640_000_000_000_000 - 50;
  f.publisher.start(); await settle();
  expect(f.publisher.snapshot()).toBeNull(); expect(f.publisher.status().failed).toBe(true);
  expect(f.admission).not.toHaveBeenCalled();
});
