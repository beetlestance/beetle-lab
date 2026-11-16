import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AdmissionValue, RuntimeObservation } from '../../src/admission/index.js';
import { createObservationPublisher } from '../../src/observation/publisher.js';
import type { ObservationPublisher } from '../../src/observation/publisher-types.js';
import { observation } from '../admission/fixtures.js';
import { hold, settle, setup } from './publisher-fixtures.js';

const publishers: ObservationPublisher[] = [];
function fixture(...args: Parameters<typeof setup>) { const f = setup(...args); publishers.push(f.publisher); return f; }
beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
  await Promise.allSettled(publishers.splice(0).map(p => p.close())); vi.useRealTimers();
});

it('starts only with both actual guards and a stored original sample', async () => {
  const f = fixture(); expect(f.publisher.status().ready).toBe(false); expect(f.sample).not.toHaveBeenCalled();
  f.guards.timeout = false; f.publisher.start(); await settle();
  expect(await f.publisher.initial).toEqual({ ready: false }); expect(f.sample).not.toHaveBeenCalled();
  expect(f.frames[0]).toMatchObject({ status: 'unknown', controls: [], capacity: { pids: 0 }, daemonId: null });
  f.guards.timeout = true; await f.tick();
  expect(f.publisher.status().ready).toBe(true);
  expect(f.frames.at(-1)).toMatchObject({ observedAt: f.clock.wall, controls: ['cpu', 'memory', 'pids'],
    guards: { source: 'supervisor', controls: ['timeout', 'output'] } });
});

it('revokes independently while a sample is held and retains the timed out original', async () => {
  const f = fixture(); f.publisher.start(); await settle(); expect(await f.publisher.initial).toEqual({ ready: true });
  const held = hold<RuntimeObservation>(); f.sample.mockReturnValueOnce(held.promise);
  await f.tick(); f.guards.output = false; await f.tick();
  expect(f.publisher.status()).toMatchObject({ ready: false, sampling: true });
  expect(f.frames.at(-1)?.status).toBe('unknown'); const count = f.sample.mock.calls.length;
  await f.tick(40); expect(f.sample).toHaveBeenCalledTimes(count);
  const closing = f.publisher.close(); let closed = false; void closing.then(() => { closed = true; });
  await settle(); expect(closed).toBe(false); expect(f.publisher.close()).toBe(closing);
  held.resolve(observation(f.clock.wall)); await closing; expect(f.frames.at(-1)?.status).toBe('unknown');
});

it('keeps one write and prioritizes pending unknown over known samples', async () => {
  const f = fixture(); const held = hold<AdmissionValue>(); f.admission.mockImplementationOnce(async input => {
    if (input.kind === 'observe') f.frames.push(input.observation); return held.promise;
  });
  f.publisher.start(); await settle(); f.guards.output = false; await f.tick();
  f.guards.output = true; await f.tick(); await f.tick();
  expect(f.admission).toHaveBeenCalledTimes(1); expect(f.publisher.status().ready).toBe(false);
  held.resolve({ stored: true }); await settle();
  expect(f.frames.map(frame => frame.status)).toEqual(['known', 'unknown']);
  expect(f.publisher.status().ready).toBe(false); await f.tick(); expect(f.publisher.status().ready).toBe(true);
});

it('does not restore from equal time, stale or future samples and recovers with newer actual data', async () => {
  const f = fixture(); f.publisher.start(); await settle();
  f.guards.output = false; f.publisher.status(); await settle(); f.guards.output = true;
  await vi.advanceTimersByTimeAsync(10); expect(f.publisher.status().ready).toBe(false);
  f.sample.mockImplementationOnce(async () => observation(f.clock.wall - 1)); await f.tick();
  expect(f.publisher.status().ready).toBe(false);
  f.sample.mockImplementationOnce(async () => observation(f.clock.wall + 1)); await f.tick();
  expect(f.publisher.status().ready).toBe(false);
  await f.tick(); expect(f.publisher.status().ready).toBe(true);
});

it('expires last known sample while the next original is held', async () => {
  const f = fixture(); f.publisher.start(); await settle();
  const held = hold<RuntimeObservation>(); f.sample.mockReturnValueOnce(held.promise); await f.tick();
  await f.tick(100); expect(f.publisher.status()).toMatchObject({ ready: false, sampling: true });
  expect(f.frames.at(-1)?.status).toBe('unknown'); held.resolve(observation(f.clock.wall)); await settle();
  expect(f.publisher.status().ready).toBe(false);
});

it.each(['reject', 'invalid'] as const)('retains sticky%s journal failure with no retry or clean close', async mode => {
  const f = fixture();
  if (mode === 'reject') f.admission.mockRejectedValueOnce(new Error('synthetic failure'));
  else f.admission.mockResolvedValueOnce({} as AdmissionValue);
  f.publisher.start(); await settle(); expect(await f.publisher.initial).toEqual({ ready: false });
  await f.tick(100); expect(f.admission).toHaveBeenCalledTimes(1);
  expect(f.publisher.status()).toMatchObject({ failed: true, ready: false });
  await expect(f.publisher.close()).rejects.toMatchObject({ reason: 'cleanup' });
  expect(() => createObservationPublisher(f.options)).toThrow('busy');
});

it('never grants readiness for stored:false known acknowledgements', async () => {
  const f = fixture(); f.admission.mockResolvedValue({ stored: false }); f.publisher.start(); await settle();
  expect(await f.publisher.initial).toEqual({ ready: false }); expect(f.publisher.status().ready).toBe(false);
});

it('fences callbacks reentering close through clock and guard providers, even when they throw', async () => {
  for (const port of ['wall', 'mono', 'output', 'timeout'] as const) {
    let closing: Promise<void> | undefined;
    const reenter = () => { closing = target.close(); throw new Error('synthetic callback'); };
    const f = fixture(port === 'wall' ? { wallNow: reenter } : port === 'mono'
      ? { monotonicNow: reenter } : { [port]: { status: reenter } }); const target = f.publisher;
    target.start(); await settle(); await closing;
    expect(f.sample).not.toHaveBeenCalled(); expect(f.frames.map(x => x.status)).toEqual(['unknown']);
    expect(target.close()).toBe(closing);
  }
});

it('drains a posted original before the final close revocation and permits reuse only after it', async () => {
  const f = fixture(); const held = hold<AdmissionValue>();
  f.admission.mockImplementationOnce(async input => { if (input.kind === 'observe') f.frames.push(input.observation); return held.promise; });
  f.publisher.start(); await settle(); const closing = f.publisher.close();
  expect(() => createObservationPublisher(f.options)).toThrow('busy'); await settle(); expect(f.admission).toHaveBeenCalledTimes(1);
  held.resolve({ stored: true }); await closing; expect(f.frames.map(x => x.status)).toEqual(['known', 'unknown']);
  const replacement = createObservationPublisher(f.options); publishers.push(replacement);
});

it('captures fixed options and ports and rejects accessor or oversized samples', async () => {
  const f = fixture(); const original = f.options.observer.sample;
  f.options.observer.sample = async () => { throw new Error('replaced'); };
  f.publisher.start(); await settle(); expect(original).toHaveBeenCalledOnce(); expect(f.publisher.status().ready).toBe(true);
  let invoked = false;
  f.sample.mockResolvedValueOnce({ ...observation(f.clock.wall), get source() { invoked = true; return 'unsafe'; } });
  await f.tick(); expect(invoked).toBe(false); expect(f.publisher.status().ready).toBe(false);
  f.sample.mockResolvedValueOnce({ ...observation(f.clock.wall), source: 'x'.repeat(20_000) }); await f.tick();
  expect(f.publisher.status().ready).toBe(false);
});

it('aborts at the local sample deadline without releasing or retrying the original', async () => {
  const held = hold<RuntimeObservation>(); let signal: AbortSignal | undefined;
  const sample = vi.fn(async (operation: { signal?: AbortSignal }) => { signal = operation.signal; return held.promise; });
  const f = fixture({ observer: { sample } }); f.publisher.start(); await settle(); await f.tick(30);
  expect(signal?.aborted).toBe(true); expect(await f.publisher.initial).toEqual({ ready: false });
  expect(f.publisher.status().sampling).toBe(true); await f.tick(100); expect(sample).toHaveBeenCalledOnce();
  expect(f.frames.filter(x => x.status === 'unknown')).toHaveLength(1);
  held.resolve(observation(f.clock.wall)); await settle(); expect(f.publisher.status().ready).toBe(false);
});

it('does not extend committed freshness while a replacement write is held', async () => {
  const f = fixture({ sampleTimeoutMs: 90 }); f.publisher.start(); await settle();
  const held = hold<AdmissionValue>(); f.admission.mockReturnValueOnce(held.promise); await f.tick(90);
  expect(f.publisher.status().ready).toBe(true); await f.tick(10); expect(f.publisher.status().ready).toBe(false);
  held.resolve({ stored: true }); await settle(); expect(f.frames.at(-1)?.status).toBe('unknown');
});

it('drains close entered by a journal callback that subsequently throws', async () => {
  const f = fixture(); let closing: Promise<void> | undefined;
  f.admission.mockImplementationOnce(async () => { closing = f.publisher.close(); throw new Error('unknown outcome'); });
  f.publisher.start(); await settle(); await expect(closing).rejects.toMatchObject({ reason: 'cleanup' });
  expect(f.publisher.close()).toBe(closing); expect(f.admission).toHaveBeenCalledOnce();
});

it('drops forged guard controls while preserving actual resource provenance and timestamps', async () => {
  const f = fixture(); const original = observation(f.clock.wall);
  original.controls.push('timeout', 'output'); delete original.idle;
  f.sample.mockResolvedValueOnce(original); f.publisher.start(); await settle();
  expect(f.frames[0]?.observedAt).toBe(original.observedAt);
  expect(f.frames[0]?.capacityProvenance).toEqual(original.capacityProvenance);
  expect(f.frames[0]?.controls).toEqual(['cpu', 'memory', 'pids']);
  expect(f.frames[0]).not.toHaveProperty('idle'); expect(f.frames[0]).not.toHaveProperty('thermal');
  expect(original.controls).toContain('timeout');
});

it('uses retained honest wall high-water on failed clock revocation', async () => {
  const f = fixture(); f.publisher.start(); await settle(); const at = f.clock.wall;
  f.clock.wall = Number.NaN; f.publisher.status(); await settle();
  expect(f.frames.at(-1)).toMatchObject({ status: 'unknown', observedAt: at });
  expect(f.publisher.status().ready).toBe(false);
});

it('independently expires a first known frame whose original journal write remains held', async () => {
  const f = fixture(); const held = hold<AdmissionValue>();
  f.admission.mockImplementationOnce(async input => { if (input.kind === 'observe') f.frames.push(input.observation); return held.promise; });
  f.publisher.start(); await settle(); await f.tick(100);
  expect(await f.publisher.initial).toEqual({ ready: false }); expect(f.publisher.status()).toMatchObject({ ready: false, publishing: true });
  held.resolve({ stored: true }); await settle(); expect(f.frames.map(x => x.status)).toEqual(['known', 'unknown']);
});

it('returns conservative readiness during reentrant clock and guard status callbacks', async () => {
  for (const port of ['wall', 'output'] as const) {
    let nested = false; let observed: boolean | undefined;
    const base = setup(); await base.publisher.close();
    const original = port === 'wall' ? base.options.wallNow! : base.options.output.status;
    const callback = () => {
      if (nested) observed = target.status().ready;
      return original();
    };
    const f = fixture(port === 'wall' ? { wallNow: callback as () => number }
      : { output: { status: callback as typeof base.options.output.status } });
    const target = f.publisher; target.start(); await settle(); expect(target.status().ready).toBe(true);
    nested = true; target.status(); expect(observed).toBe(false); nested = false;
  }
});

it('retains journal ownership and cached failed close when final revocation rejects', async () => {
  const f = fixture(); f.publisher.start(); await settle();
  f.admission.mockRejectedValueOnce(new Error('synthetic final rejection'));
  const closing = f.publisher.close(); await expect(closing).rejects.toMatchObject({ reason: 'cleanup' });
  expect(f.publisher.close()).toBe(closing); expect(() => createObservationPublisher(f.options)).toThrow('busy');
  expect(f.publisher.status()).toMatchObject({ ready: false, closed: true, failed: true });
});
