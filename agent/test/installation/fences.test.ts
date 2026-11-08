import { describe, it, expect } from 'vitest';
import type { AdmissionCommand, AdmissionValue } from '../../src/admission/index.js';
import { configuration, observation } from '../admission/fixtures.js';
import { fixture, operation, scope, deferred } from './fixtures.js';
const f = fixture();
describe('installation fences and bounded intake', () => {
  it('fences preflight callback reentry into cached close', async () => {
    const e = await f.setup(); let close!: Promise<void>;
    const catalog = { ...e.catalog, preflight(input: unknown) { close = manager.close(); return e.catalog.preflight(input); } };
    const manager = e.create({ catalog });
    await expect(manager.enqueue(e.offer)).rejects.toMatchObject({ reason: 'closed' }); await close;
    await expect(e.owner.get(scope(e.offer))).rejects.toMatchObject({ code: 'not_found' });
  });
  it('reserves operation custody before getter/proxy reentry and fences drive budget callbacks', async () => {
    const e = await f.setup(); const manager = e.create(); await e.accepted(manager);
    const budget = new Proxy(operation(), { getOwnPropertyDescriptor(target, name) { void manager.close(); return Reflect.getOwnPropertyDescriptor(target, name); } });
    await expect(manager.drive(scope(e.offer), budget)).rejects.toMatchObject({ reason: 'closed' });
    await manager.close(); expect(e.backend.creates).toBe(0);
  });
  it('snapshots offer, scope and budget before returning control to the caller', async () => {
    const e = await f.setup();
    const manager = e.create({ stagerFor: () => ({ prepare: () => ({ result: Promise.resolve({ ok: false, reason: 'provider' }), quiesced: Promise.resolve() }) }) });
    const offer = structuredClone(e.offer); const enqueue = manager.enqueue(offer); offer.intentDigest = 'f'.repeat(64);
    expect((await enqueue).accepted).toBe(true);
    const key = scope(e.offer); const budget = operation(); const driving = manager.drive(key, budget);
    key.attemptId = f.job(2).attemptId; budget.deadline = 0;
    expect((await driving).kind).toBe('released');
  });
  it('persists cancellation before admission and never stages', async () => {
    const e = await f.setup(); let preparations = 0;
    const manager = e.create({ stagerFor() { preparations++; return e.stager; } });
    await e.accepted(manager); await manager.cancel(scope(e.offer));
    await expect(manager.drive(scope(e.offer), operation())).rejects.toMatchObject({ reason: 'closed' });
    expect(preparations).toBe(0); expect((await manager.inspect(scope(e.offer))).allocation).toBeNull();
  });
  it('cancel overtakes an issued admission and fences its late successful continuation', async () => {
    const e = await f.setup(); const entered = deferred<void>(); const release = deferred<void>();
    const original = e.owner.admission.bind(e.owner);
    e.owner.admission = async (command: AdmissionCommand): Promise<AdmissionValue> => {
      const value = await original(command);
      if (command.kind === 'admit') { entered.resolve(); await release.promise; }
      return value;
    };
    const manager = e.create({ stagerFor() { throw new Error('late prepare'); } }); await e.accepted(manager);
    const drive = manager.drive(scope(e.offer), operation()); await entered.promise;
    await manager.cancel(scope(e.offer)); release.resolve();
    expect((await drive).kind).toBe('released'); expect(e.backend.creates).toBe(0);
  });
  it('returns committed cancel and inspect while issued stop remains owned by close', async () => {
    const e = await f.setup(); const manager = e.create(); await e.accepted(manager);
    await manager.drive(scope(e.offer), operation()); expect(e.backend.starts).toBe(1);
    const entered = deferred<void>(); const release = deferred<void>();
    const stop = e.backend.stop.bind(e.backend);
    e.backend.stop = async (...args) => { entered.resolve(); await release.promise; return stop(...args); };
    const cancelled = await manager.cancel(scope(e.offer)); await entered.promise; expect(cancelled).toBeDefined();
    expect((await manager.inspect(scope(e.offer))).allocation?.status).toBe('charged');
    let done = false; const closing = manager.close(); void closing.then(() => { done = true; });
    await new Promise<void>(resolve => setImmediate(resolve)); expect(done).toBe(false);
    release.resolve(); await closing;
  });
  it('pending_full is never accepted, and rejects scope and offer conflicts', async () => {
    const e = await f.setup(); const original = e.owner.admission.bind(e.owner);
    e.owner.admission = async command => command.kind === 'offer' ? { kind: 'defer', reason: 'pending_full' } : original(command);
    const manager = e.create(); expect(await manager.enqueue(e.offer)).toEqual({ accepted: false, decision: { kind: 'defer', reason: 'pending_full' } });
    e.owner.admission = original; await e.accepted(manager);
    await expect(manager.enqueue({ ...e.offer, intentDigest: 'f'.repeat(64) })).rejects.toMatchObject({ code: 'conflict' });
    await expect(manager.drive({ ...scope(e.offer), workspaceId: f.job(2).organizationId }, operation())).rejects.toMatchObject({ code: 'not_found' });
  });
  it('retains 64 rejected-cleanup owners and blocks a 65th without releasing charge', async () => {
    const e = await f.setup(); const config = configuration();
    config.maxTimeoutMs = e.offer.budget.timeoutMs;
    config.maxConcurrent = 64;
    config.pool = { cpuMillis: 100_000, memoryBytes: 100_000, pids: 100_000, outputBytes: 100_000, stagingBytes: 1_000_000_000 };
    config.perRun = { ...config.pool };
    const observe = observation(e.time.wall() + 1); observe.capacity = { ...config.pool }; observe.freeDiskBytes = 1_000_000_000;
    await e.owner.admission({ kind: 'configure', configuration: config });
    await e.owner.admission({ kind: 'observe', observation: observe }); e.time.advance(1);
    const manager = e.create({ stagerFor: () => ({ prepare: () => ({
      result: Promise.resolve({ ok: false, reason: 'provider' }), quiesced: Promise.reject(new Error('synthetic original cleanup')) }) }) });
    for (let i = 1; i <= 64; i++) {
      const offer = { ...e.offer, attemptId: f.job(i).attemptId,
        budget: { ...e.offer.budget, cpuMillis: 100, memoryBytes: 100, pids: 1, outputBytes: 1 } };
      await e.accepted(manager, offer);
      await expect(manager.drive(scope(offer), operation())).rejects.toMatchObject({ reason: 'cleanup' });
      expect((await manager.inspect(scope(offer))).allocation?.status).toBe('charged');
    }
    const offer = { ...e.offer, attemptId: f.job(65).attemptId }; await e.accepted(manager, offer);
    await expect(manager.drive(scope(offer), operation())).rejects.toMatchObject({ reason: 'capacity' });
    await expect(manager.close()).rejects.toMatchObject({ reason: 'cleanup' });
  });
});
