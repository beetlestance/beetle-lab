import { describe, expect, it, vi } from 'vitest';
import { AttemptResources, SamplingAdmission } from '../../src/telemetry/index.js';
import { ResourceAggregate } from '../../src/telemetry/aggregate.js';
import type { Operation, ResourceReading } from '../../src/backends/docker/index.js';
import { clock, deferred } from '../supervisor/fixtures.js';

const reading = (cpuMillis = 1, memoryBytes = 10, pids = 2): ResourceReading => ({ cpuMillis, memoryBytes, pids, reason: null });
const turns = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };
describe('truthful constant-space aggregate', () => {
  it('keeps cumulative CPU, sampled maxima, observed zero and reset provenance', () => {
    const aggregate = new ResourceAggregate(['cpu']);
    expect(aggregate.summary()).toMatchObject({ cpuMillis: null, peakMemoryBytes: null, peakPids: null, samples: 0, lastSampleAt: null });
    aggregate.observe(reading(0, 0, 0), 0);
    expect(aggregate.summary()).toMatchObject({ cpuMillis: 0, peakMemoryBytes: 0, peakPids: 0, lastSampleAt: '1970-01-01T00:00:00.000Z' });
    aggregate.observe(reading(12, 50, 5), 1000); aggregate.observe(reading(20, 10, 2), 2000);
    expect(aggregate.summary()).toMatchObject({ cpuMillis: 20, peakMemoryBytes: 50, peakPids: 5, samples: 3, outputBytes: null });
    aggregate.observe(reading(1, 20, 3), 3000);
    expect(aggregate.summary()).toMatchObject({ cpuMillis: null, reason: 'counter_reset', samples: 4 });
    aggregate.observe(reading(2), 4000);
    expect(aggregate.summary()).toMatchObject({ cpuMillis: 2, reason: 'counter_reset' });
  });
  it('preserves adapter reset provenance that whole-millisecond values cannot reveal', () => {
    const aggregate = new ResourceAggregate(['cpu']);
    aggregate.observe(reading(1), 1000);
    aggregate.observe({ ...reading(), cpuMillis: null, reason: 'counter_reset' }, 2000);
    expect(aggregate.summary()).toMatchObject({ cpuMillis: null, reason: 'counter_reset' });
    aggregate.observe(reading(2), 3000);
    expect(aggregate.summary()).toMatchObject({ cpuMillis: 2, reason: 'counter_reset' });
  });
  it('does not carry prior-process maxima and retains null rather than unknown zero', () => {
    const aggregate = new ResourceAggregate(['memory', 'pids']); aggregate.restarted();
    aggregate.observe({ cpuMillis: null, memoryBytes: null, pids: null, reason: 'unsupported' }, 1000);
    expect(aggregate.summary()).toMatchObject({ samples: 0, missedSamples: 1, lastSampleAt: null, peakMemoryBytes: null, reason: 'unsupported' });
    aggregate.observe({ cpuMillis: null, memoryBytes: 5, pids: null, reason: 'unsupported' }, 2000);
    expect(aggregate.summary()).toMatchObject({ cpuMillis: null, peakMemoryBytes: 5, peakPids: null, reason: 'restarted', samples: 1 });
    aggregate.observe(reading(-1), 3000); aggregate.observe(reading(), NaN);
    expect(aggregate.summary()).toMatchObject({ samples: 1, missedSamples: 3, reason: 'clock' });
  });
});
describe('tick-driven resource original ownership', () => {
  it('shares two reads without a queue, accounts skipped cadence and drains ignored aborts', async () => {
    const time = clock(); const admission = new SamplingAdmission();
    const held = [deferred<ResourceReading>(), deferred<ResourceReading>(), deferred<ResourceReading>()];
    const operations: Operation[] = [];
    const monitors = held.map(reply => new AttemptResources({ clock: time, admission,
      read: async operation => { operations.push(operation); return reply.promise; } }));
    monitors.forEach(monitor => { monitor.running(false); monitor.tick(); }); await turns();
    expect(operations).toHaveLength(2); expect(monitors[2]!.final()).toMatchObject({ samples: 0, missedSamples: 1 });
    time.advance(5000); monitors.forEach(monitor => monitor.tick());
    expect(monitors[0]!.due()).toMatchObject({ samples: 0, missedSamples: 5 });
    const closing = monitors[0]!.close(); expect(monitors[0]!.close()).toBe(closing);
    expect(operations[0]!.signal!.aborted).toBe(true);
    let closed = false; void closing.then(() => { closed = true; }); await turns(); expect(closed).toBe(false);
    monitors[2]!.tick(); await turns(); expect(operations).toHaveLength(2);
    held[0]!.resolve(reading(100)); await closing;
    expect(monitors[0]!.final()).toMatchObject({ samples: 0, missedSamples: 6 });
    time.advance(1000); monitors[2]!.tick(); await turns(); expect(operations).toHaveLength(3);
    held[1]!.resolve(reading()); held[2]!.resolve(reading());
    await Promise.all(monitors.map(monitor => monitor.close()));
  });
  it('retains deadline-expired originals until their actual completion and excludes late readings', async () => {
    vi.useFakeTimers();
    try {
      const time = clock(); const reply = deferred<ResourceReading>(); let operation: Operation | undefined;
      const monitor = new AttemptResources({ clock: time, admission: new SamplingAdmission(), read: input => { operation = input; return reply.promise; } });
      monitor.running(false); monitor.tick(); await turns();
      await vi.advanceTimersByTimeAsync(1001); expect(operation!.signal!.aborted).toBe(true); expect(monitor.pending).toBe(true);
      time.advance(1000); monitor.tick(); expect(monitor.final()).toMatchObject({ samples: 0, missedSamples: 1 });
      reply.resolve(reading()); await turns(); expect(monitor.pending).toBe(false);
      expect(monitor.final()).toMatchObject({ samples: 0, missedSamples: 2, lastSampleAt: null }); await monitor.close();
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it('fences rollback and reentrant close without leaking timers or dispatching another read', async () => {
    const time = clock(); let closing: Promise<void> | undefined; let calls = 0;
    const monitor = new AttemptResources({ clock: time, admission: new SamplingAdmission(), read: async () => {
      calls++; closing = monitor.close(); return reading();
    } });
    monitor.running(false); monitor.tick(); await turns(); await closing;
    time.advance(5000); monitor.tick(); expect(calls).toBe(1); expect(monitor.due()).toBeUndefined();
    expect(monitor.final()).toMatchObject({ samples: 0, missedSamples: 1 });
    const other = new AttemptResources({ clock: time, admission: new SamplingAdmission(), read: async () => reading() });
    other.running(false); other.tick(); await turns(); time.wallOnly(0); time.advance(1000); other.tick();
    expect(other.final()).toMatchObject({ samples: 1, reason: 'clock', missedSamples: 1 }); await other.close();
  });
  it('installs close ownership before dispatching reentrant abort listeners', async () => {
    const time = clock(); const held = deferred<ResourceReading>(); let nested: Promise<void> | undefined;
    const monitor = new AttemptResources({ clock: time, admission: new SamplingAdmission(), read: operation => {
      operation.signal!.addEventListener('abort', () => { nested = monitor.close(); }); return held.promise;
    } });
    monitor.running(false); monitor.tick(); await turns(); const closing = monitor.close();
    expect(nested).toBe(closing); held.resolve(reading()); await closing;
    expect(monitor.final()).toMatchObject({ samples: 0, missedSamples: 1 });
  });

});
