import { describe, it, expect } from 'vitest';
import { prepareRuntime, runtimeName } from '../../src/backends/docker/index.js';
import { fixture, operation, scope } from './fixtures.js';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { configuration, observation } from '../admission/fixtures.js';
import { estimateStaging } from '../../src/admission/index.js';
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
    expect(await manager.drive(scope(e.offer), operation())).toEqual({ kind: 'rejected', reason: 'installed_identity' });
    expect((await manager.inspect(scope(e.offer))).allocation?.status).toBe('charged');
    expect(e.backend.creates).toBe(0); expect(e.backend.starts).toBe(0);
    await manager.close();
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
    const disk = { outputBytes: e.offer.budget.outputBytes * 66,
      stagingBytes: estimateStaging(e.offer).totalBytes * 66 };
    const config = configuration(); config.maxTimeoutMs = e.offer.budget.timeoutMs;
    config.pool = { ...config.pool, ...disk };
    const capacity = observation(e.time.wall()); capacity.capacity = { ...capacity.capacity, ...disk };
    await e.owner.admission({ kind: 'configure', configuration: config });
    await e.owner.admission({ kind: 'observe', observation: capacity });
    for (let i = 1; i <= 66; i++) {
      const offer = { ...e.offer, attemptId: f.job(i).attemptId };
      await e.accepted(manager, offer); await e.finish(manager, offer);
    }
    expect(e.backend.starts).toBe(66); expect(e.manager.size).toBe(0);
    await manager.close();
    await f.close(e.owner);
    const db = new DatabaseSync(e.journalPath, { readOnly: true });
    try {
      expect(db.prepare("SELECT COUNT(*) AS count FROM disk_holds WHERE phase='retained'").get()?.count).toBe(66);
      expect(db.prepare('SELECT * FROM disk_retention_stats').get()).toMatchObject({ held_count: 66,
        held_output_bytes: disk.outputBytes, retained_output_bytes: disk.outputBytes,
        held_staging_bytes: disk.stagingBytes, retained_staging_bytes: disk.stagingBytes });
      expect(db.prepare('SELECT COUNT(*) AS count FROM reservations WHERE charged=1').get()?.count).toBe(0);
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally { db.close(); }
  }, 30000);
});
