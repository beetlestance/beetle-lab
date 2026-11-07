import { describe, expect, it } from 'vitest';
import { admissionFixture, configuration, now, observation, scope } from './fixtures.js';

const f = admissionFixture();
describe('freshness and honest optional sensors', () => {
  it('requires every budget control and fresh supervisor guards independently of Docker flags', async () => {
    const journal = await f.configured(); const config = configuration();
    config.profiles[0]!.controls = [];
    await expect(journal.admission({ kind: 'configure', configuration: config })).rejects.toMatchObject({ code: 'invalid_input' });
    const noGuards = observation(now + 2000); delete noGuards.guards;
    noGuards.controls.push('timeout', 'output');
    await journal.admission({ kind: 'observe', observation: noGuards });
    expect(await f.enqueue(journal, f.job(), now + 2000)).toEqual({ kind: 'reject', reason: 'controls_unavailable' });
    const fresh = observation(now + 2001); fresh.guards!.controls = ['timeout'];
    await journal.admission({ kind: 'observe', observation: fresh });
    expect(await f.enqueue(journal, f.job(), now + 2001)).toEqual({ kind: 'reject', reason: 'controls_unavailable' });
    fresh.observedAt++; fresh.guards!.observedAt++; fresh.guards!.controls = ['timeout', 'output'];
    await journal.admission({ kind: 'observe', observation: fresh });
    expect(await f.enqueue(journal, f.job(), now + 2002)).toEqual({ kind: 'defer', reason: 'queued' });
  });
  it('rejects required hard filesystem output quota even if mislisted in the trusted catalog', async () => {
    const journal = await f.configured(); const config = configuration(); config.profiles[0]!.capabilities.push('hard-output-quota');
    await journal.admission({ kind: 'configure', configuration: config }); const a = f.job();
    a.requiredCapabilities = ['hard-output-quota'];
    expect(await f.enqueue(journal, a)).toEqual({ kind: 'reject', reason: 'unsupported_capability' });
  });
  it('ignores stale capacity and independently stale sensor updates', async () => {
    const journal = await f.configured(); const a = f.job(); a.executionPolicy.preferIdle = true;
    const busy = observation(now + 1); busy.idle!.value = false;
    await journal.admission({ kind: 'observe', observation: busy }); await f.enqueue(journal, a, now + 1);
    expect(await journal.admission({ kind: 'observe', observation: observation(now) })).toEqual({ stored: false });
    const newer = observation(now + 2); newer.idle!.observedAt = now; newer.idle!.value = true;
    await journal.admission({ kind: 'observe', observation: newer });
    expect(await f.admit(journal, a, now + 2)).toEqual({ kind: 'defer', reason: 'runtime_busy' });
    const unknown = observation(now + 3); unknown.idle!.value = null;
    await journal.admission({ kind: 'observe', observation: unknown });
    expect(await f.admit(journal, a, now + 3)).toMatchObject({ status: 'charged' });
  });
  it('blocks required unknown/stale idle and thermal sensors without inventing readings', async () => {
    const journal = await f.configured(); const config = configuration(); config.requiredSensors = ['idle', 'thermal'];
    config.thermal = { maximumCelsius: 80, source: 'synthetic-policy', configuredAt: now };
    await journal.admission({ kind: 'configure', configuration: config });
    const a = f.job(); await f.enqueue(journal, a);
    expect(await f.admit(journal, a)).toEqual({ kind: 'defer', reason: 'thermal_unknown' });
    const warm = observation(now + 1); warm.thermal = { source: 'synthetic', observedAt: now + 1, celsius: 90 };
    await journal.admission({ kind: 'observe', observation: warm });
    expect(await f.admit(journal, a, now + 1)).toEqual({ kind: 'defer', reason: 'thermal_busy' });
    const missing = observation(now + 2); missing.idle!.value = null;
    await journal.admission({ kind: 'observe', observation: missing });
    expect(await f.admit(journal, a, now + 2)).toEqual({ kind: 'defer', reason: 'idle_unknown' });
    const stale = observation(now + 2000); stale.thermal = { source: 'synthetic', observedAt: now + 1, celsius: 50 };
    await journal.admission({ kind: 'observe', observation: stale });
    expect(await f.admit(journal, a, now + 2000)).toEqual({ kind: 'defer', reason: 'thermal_unknown' });
  });
  it('persists clock high-water across restart and rejects rollback admission', async () => {
    const path = f.path(); let journal = await f.configured(path); const a = f.job(); await f.enqueue(journal, a, now + 100);
    await f.close(journal); journal = await f.open(path);
    expect(await f.admit(journal, a, now + 99)).toEqual({ kind: 'defer', reason: 'clock_rollback' });
    expect(await f.admit(journal, a, now + 100)).toMatchObject({ status: 'charged' });
  });
  it('subtracts explicit control reserve and headroom from fresh runtime capacity', async () => {
    const journal = await f.configured(); const config = configuration(); config.pool.cpuMillis = 5000; config.perRun.cpuMillis = 5000;
    await journal.admission({ kind: 'configure', configuration: config });
    const a = f.job(1, 4900);
    expect(await f.enqueue(journal, a)).toEqual({ kind: 'reject', reason: 'impossible_request' });
  });
});
describe('bounded FIFO bypass and durable promotion', () => {
  it('preserves FIFO when an older request fits now', async () => {
    const journal = await f.configured(); const a = f.job(); const b = f.job(2);
    await f.enqueue(journal, a); await f.enqueue(journal, b);
    expect(await f.admit(journal, b)).toEqual({ kind: 'defer', reason: 'fifo_predecessor' });
    expect(await f.admit(journal, a)).toMatchObject({ status: 'charged' });
    expect(await f.admit(journal, b)).toMatchObject({ status: 'charged' });
  });
  it('allows small jobs for 30 seconds then drains for the promoted older request across restart', async () => {
    const path = f.path(); let journal = await f.configured(path); const active = f.job(1, 2500); const old = f.job(2, 3000);
    const small = f.job(3, 1000); const later = f.job(4, 500);
    await f.enqueue(journal, active); await f.admit(journal, active); await f.enqueue(journal, old);
    await f.enqueue(journal, small); expect(await f.admit(journal, small)).toMatchObject({ status: 'charged' });
    await f.close(journal); journal = await f.open(path);
    await journal.admission({ kind: 'observe', observation: observation(now + 30_000) });
    await f.enqueue(journal, later, now + 30_000);
    expect(await f.admit(journal, later, now + 30_000)).toEqual({ kind: 'defer', reason: 'promoted_predecessor' });
    await journal.admission({ kind: 'abortUnstarted', key: scope(active) });
    await journal.admission({ kind: 'abortUnstarted', key: scope(small) });
    expect(await f.admit(journal, old, now + 30_000)).toMatchObject({ status: 'charged' });
  });
  it('promotes unknown-age legacy offers conservatively after explicit validation', async () => {
    const journal = await f.configured(); const active = f.job(1, 3000); const old = f.job(2, 2000); const small = f.job(3, 500);
    await f.enqueue(journal, active); await f.admit(journal, active);
    await journal.immutableOffer(old); await f.enqueue(journal, old); await f.enqueue(journal, small);
    expect(await f.admit(journal, small)).toEqual({ kind: 'defer', reason: 'promoted_predecessor' });
  });
  it('caps the queue at 1024 and candidate scan at 100; paged reservation inputs remain bounded', async () => {
    const journal = await f.configured();
    for (let id = 1; id <= 1024; id++) expect(await f.enqueue(journal, f.job(id, 100))).toEqual({ kind: 'defer', reason: 'queued' });
    const overflow = f.job(1025, 100);
    expect(await f.enqueue(journal, overflow)).toEqual({ kind: 'defer', reason: 'pending_full' });
    await expect(journal.get(scope(overflow))).rejects.toMatchObject({ code: 'not_found' });
    expect(await f.admit(journal, f.job(101, 100))).toEqual({ kind: 'defer', reason: 'scan_window' });
    await expect(journal.admission({ kind: 'reservations', limit: 101 })).rejects.toMatchObject({ code: 'invalid_input' });
  }, 15_000);
  it('caps charged reservations at 64 and paginates retained reservations', async () => {
    const journal = await f.configured(); const config = configuration();
    config.pool = { cpuMillis: 100_000, memoryBytes: 100_000, pids: 1000, outputBytes: 100_000, stagingBytes: 16_000_000 };
    config.perRun = config.pool; config.maxConcurrent = 64;
    await journal.admission({ kind: 'configure', configuration: config });
    await journal.admission({ kind: 'observe', observation: { ...observation(now + 1), capacity: config.pool, freeDiskBytes: 32_000_000 } });
    for (let id = 1; id <= 65; id++) {
      const offer = f.job(id, 100); offer.budget.memoryBytes = 100; offer.budget.pids = 1;
      await f.enqueue(journal, offer, now + 1);
      const result = await f.admit(journal, offer, now + 1);
      if (id <= 64) expect(result).toMatchObject({ status: 'charged' });
      else expect(result).toEqual({ kind: 'defer', reason: 'concurrency' });
    }
    const page = await journal.admission({ kind: 'reservations', limit: 10 });
    if (!('reservations' in page) || !page.cursor) throw new Error('expected page');
    expect(page.reservations).toHaveLength(10);
    expect(await journal.admission({ kind: 'reservations', limit: 100, cursor: page.cursor })).toMatchObject({ reservations: expect.any(Array) });
    await expect(journal.admission({ kind: 'configure', configuration: { ...config, maxConcurrent: 65 } })).rejects.toMatchObject({ code: 'invalid_input' });
  });
});
