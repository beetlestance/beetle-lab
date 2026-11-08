import { describe, it, expect } from 'vitest';
import { prepareRuntime, runtimeName } from '../../src/backends/docker/index.js';
import { fixture, operation, scope } from './fixtures.js';
import { join } from 'node:path';
const f = fixture();
describe('installation durable composition, synthetic Docker only', () => {
  it('uses real Stager, SQLite, Supervisor and controller; replay never redispatches', async () => {
    const e = await f.setup(); const manager = e.create(); await e.accepted(manager);
    await e.accepted(manager); await e.finish(manager);
    expect(e.backend.starts).toBe(1); expect(e.backend.creates).toBe(1);
    expect((await manager.inspect(scope(e.offer))).allocation?.status).toBe('released');
    expect(await manager.drive(scope(e.offer), operation())).toEqual({ kind: 'released', collection: 'failed' });
    expect(e.manager.size).toBe(0);
    expect(manager.close()).toBe(manager.close()); await manager.close();
    // Journal remains owned by bootstrap.
    expect(await e.owner.get(scope(e.offer))).toBeDefined();
  });
  it('aborts abandoned tokenless setup without calling staging', async () => {
    const e = await f.setup(); await f.enqueue(e.owner, e.offer); await f.admit(e.owner, e.offer);
    const manager = e.create({ stagerFor() { throw new Error('must not restage'); } });
    expect(await manager.drive(scope(e.offer), operation())).toEqual({ kind: 'released', collection: 'failed' });
    expect((await manager.inspect(scope(e.offer))).allocation?.aborted).toBe(true);
    expect(e.backend.creates).toBe(0);
  });
  it('reconstructs claimed plan including secrets and never dispatches create/start', async () => {
    const e = await f.setup(); await f.enqueue(e.owner, e.offer); await f.admit(e.owner, e.offer);
    const root = join(e.engine.profile.stagingRoot, runtimeName({ ...scope(e.offer), installationId: e.engine.profile.installationId }));
    const plan = prepareRuntime({ offer: e.offer, manifest: e.engine.manifest, profile: e.engine.profile,
      generation: 1, staged: { input: join(root, 'input'), output: join(root, 'output'), secrets: join(root, 'secrets') } });
    if (!plan.ok) throw new Error(plan.reason);
    await e.owner.admission({ kind: 'claimCreate', key: scope(e.offer), specDigest: plan.value.specDigest });
    const manager = e.create({ stagerFor() { throw new Error('must not restage'); } });
    await manager.drive(scope(e.offer), operation());
    expect(e.backend.creates).toBe(0); expect(e.backend.starts).toBe(0);
    expect((await manager.inspect(scope(e.offer))).allocation?.status).toBe('charged');
  });
  it('retains claimed charge when exact catalogue pins disappear', async () => {
    const e = await f.setup(); await f.enqueue(e.owner, e.offer); await f.admit(e.owner, e.offer);
    await e.owner.admission({ kind: 'claimCreate', key: scope(e.offer), specDigest: 'f'.repeat(64) });
    const manager = e.create({ catalog: { ...e.catalog, resolve() { throw new Error('synthetic missing exact pin'); } } });
    await expect(manager.drive(scope(e.offer), operation())).rejects.toThrow('synthetic missing exact pin');
    expect((await manager.inspect(scope(e.offer))).allocation?.status).toBe('charged');
    expect(e.backend.creates).toBe(0); expect(e.backend.starts).toBe(0);
    await expect(manager.close()).rejects.toMatchObject({ reason: 'cleanup' });
  });
  it('keeps mismatched reconstruction charged', async () => {
    const e = await f.setup(); await f.enqueue(e.owner, e.offer); await f.admit(e.owner, e.offer);
    await e.owner.admission({ kind: 'claimCreate', key: scope(e.offer), specDigest: 'f'.repeat(64) });
    const manager = e.create();
    await expect(manager.drive(scope(e.offer), operation())).rejects.toMatchObject({ reason: 'catalog' });
    expect((await manager.inspect(scope(e.offer))).allocation?.status).toBe('charged');
    expect(e.backend.creates).toBe(0); await expect(manager.close()).rejects.toMatchObject({ reason: 'cleanup' });
  });
  it('retires original controllers across more than 64 sequential real staged attempts', async () => {
    const e = await f.setup(); const manager = e.create();
    for (let i = 1; i <= 66; i++) {
      const offer = { ...e.offer, attemptId: f.job(i).attemptId };
      await e.accepted(manager, offer); await e.finish(manager, offer);
    }
    expect(e.backend.starts).toBe(66); expect(e.manager.size).toBe(0);
    await manager.close();
  }, 30000);
});
