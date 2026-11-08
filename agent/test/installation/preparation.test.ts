import { describe, it, expect } from 'vitest';
import type { Preparation, StagingResult } from '../../src/staging/index.js';
import type { RuntimePlan } from '../../src/backends/docker/index.js';
import { fixture, operation, scope, deferred } from './fixtures.js';
const f = fixture();
const fail = (reason: 'provider' | 'busy' = 'provider'): Preparation => ({ result: Promise.resolve({ ok: false, reason }), quiesced: Promise.resolve() });
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
describe('original preparation ownership', () => {
  it('does not launch or release before original quiescence, and cancels late result', async () => {
    const e = await f.setup(); const quiescence = deferred<void>(); const entered = deferred<void>();
    const result = deferred<StagingResult<RuntimePlan>>();
    const manager = e.create({ stagerFor: () => ({ prepare() { entered.resolve(); return { result: result.promise, quiesced: quiescence.promise }; } }) });
    await e.accepted(manager); const driving = manager.drive(scope(e.offer), operation()); await entered.promise;
    result.resolve({ ok: false, reason: 'provider' });
    await manager.cancel(scope(e.offer));
    expect((await manager.inspect(scope(e.offer))).allocation?.status).toBe('charged');
    let finished = false; void driving.then(() => { finished = true; }); await turn(); expect(finished).toBe(false);
    quiescence.resolve(); expect(await driving).toEqual({ kind: 'released', collection: 'failed' });
    expect(e.backend.starts).toBe(0); await manager.close();
  });
  it('holds successful real staging until original quiescence; cached close fences launch', async () => {
    const e = await f.setup(); const entered = deferred<void>(); const quiet = deferred<void>();
    const manager = e.create({ stagerFor: () => ({ prepare(input) {
      const original = e.stager.prepare(input);
      const result = original.result.then(value => { entered.resolve(); return value; });
      return { result, quiesced: original.quiesced.then(() => quiet.promise) };
    } }) });
    await e.accepted(manager); const driving = manager.drive(scope(e.offer), operation()); await entered.promise;
    expect(e.backend.starts).toBe(0); const closing = manager.close(); expect(manager.close()).toBe(closing);
    let closed = false; void closing.then(() => { closed = true; }); await turn(); expect(closed).toBe(false);
    quiet.resolve(); expect((await driving).kind).toBe('released'); await closing; expect(e.backend.starts).toBe(0);
  });
  it('ordinary preparation failure releases but rejected original cleanup stays charged', async () => {
    const e = await f.setup();
    const manager = e.create({ stagerFor: () => ({ prepare: () => fail() }) });
    await e.accepted(manager); expect((await manager.drive(scope(e.offer), operation())).kind).toBe('released');
    await manager.close();
    const offer = { ...e.offer, attemptId: f.job(2).attemptId };
    const rejected = e.create({ stagerFor: () => ({ prepare: () => ({ result: Promise.resolve({ ok: false, reason: 'provider' }), quiesced: Promise.reject(new Error('synthetic close')) }) }) });
    await e.accepted(rejected, offer);
    await expect(rejected.drive(scope(offer), operation())).rejects.toMatchObject({ reason: 'cleanup' });
    expect((await rejected.inspect(scope(offer))).allocation?.status).toBe('charged');
    await expect(rejected.close()).rejects.toMatchObject({ reason: 'cleanup' });
  });
  it('defers a third preparation before charging and retries a fresh busy setup once', async () => {
    const e = await f.setup(); const entered = deferred<void>(); const settled = deferred<void>(); let calls = 0;
    const manager = e.create({ stagerFor: () => ({ prepare() {
      calls++; if (calls === 2) entered.resolve();
      return { result: settled.promise.then(() => ({ ok: false, reason: 'provider' })), quiesced: settled.promise };
    } }) });
    const offers = [1, 2, 3].map(i => ({ ...e.offer, attemptId: f.job(i).attemptId, budget: { ...e.offer.budget, pids: 1, cpuMillis: 100, memoryBytes: 100 } }));
    // All simultaneous reservations require independent staging disk capacity.
    const config = (await import('../admission/fixtures.js')).configuration();
    config.pool.stagingBytes = 100_000_000; config.perRun.stagingBytes = 100_000_000;
    await e.owner.admission({ kind: 'configure', configuration: config });
    const observe = (await import('../admission/fixtures.js')).observation(e.time.wall() + 1);
    observe.freeDiskBytes = 100_000_000; observe.capacity.stagingBytes = 100_000_000;
    await e.owner.admission({ kind: 'observe', observation: observe }); e.time.advance(1);
    for (const offer of offers) await e.accepted(manager, offer);
    const first = manager.drive(scope(offers[0]!), operation()); const second = manager.drive(scope(offers[1]!), operation());
    await entered.promise;
    expect(await manager.drive(scope(offers[2]!), operation())).toMatchObject({ kind: 'deferred', reason: 'staging_busy' });
    expect((await manager.inspect(scope(offers[2]!))).allocation).toBeNull();
    settled.resolve(); await Promise.all([first, second]);
    expect((await manager.drive(scope(offers[2]!), operation())).kind).toBe('released'); expect(calls).toBe(3);
  });
  it('Stager.busy preserves fresh charged setup for later retry', async () => {
    const e = await f.setup(); let calls = 0;
    const manager = e.create({ stagerFor: () => ({ prepare: () => fail(++calls === 1 ? 'busy' : 'provider') }) });
    await e.accepted(manager); expect(await manager.drive(scope(e.offer), operation())).toMatchObject({ kind: 'deferred' });
    expect((await manager.inspect(scope(e.offer))).allocation?.status).toBe('charged');
    expect((await manager.drive(scope(e.offer), operation())).kind).toBe('released'); expect(calls).toBe(2);
  });
});
