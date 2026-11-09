import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { validate } from '@beetle/contracts';
import { createEngineCatalog } from '../../src/catalog/index.js';
import { CapabilityView } from '../../src/bootstrap/capabilities.js';
import { capacityPolicyDigest } from '../../src/bootstrap/capacity-observation.js';
import { configuration } from '../admission/fixtures.js';
import { registration } from '../catalog/fixtures.js';
import { setup, settle } from '../observation/publisher-fixtures.js';

const owners: ReturnType<typeof setup>[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
  try { await Promise.all(owners.splice(0).map(f => f.publisher.close())); }
  finally { vi.useRealTimers(); }
});
async function fixture() {
  const f = setup(); owners.push(f); f.publisher.start(); await settle();
  const config = configuration(); const catalog = createEngineCatalog([registration()]);
  const options = { configuration: config, catalog, published: () => f.publisher.snapshot(), wallNow: () => f.clock.wall };
  return { ...f, config, catalog, options };
}

it('projects total pool, per-run clipping, staging/concurrency and explicit provenance with one overhead subtraction', async () => {
  const f = await fixture();
  f.config.pool = { cpuMillis: 3000, memoryBytes: 8000, pids: 50, outputBytes: 10000, stagingBytes: 12000 };
  f.config.perRun = { cpuMillis: 2000, memoryBytes: 3000, pids: 20, outputBytes: 4000, stagingBytes: 2000 };
  f.config.maxConcurrent = 3;
  const view = new CapabilityView(f.options); const response = await view.capabilities();
  expect(validate('Capabilities', response).ok).toBe(true);
  expect(response.capacity).toEqual({ cpuMillis: 2000, memoryBytes: 3000, pids: 20, outputBytes: 4000, timeoutMs: 1000 });
  expect(response.observation).toMatchObject({ sampleStartedAtMs: 100000, observedAtMs: 100000, expiresAtMs: 100100,
    pool: { cpuMillis: 3000, memoryBytes: 4800, pids: 48, outputBytes: 4000, stagingBytes: 12000 },
    perRunStagingBytes: 2000, maxConcurrent: 3, physicalPidCapacity: null, diskSource: 'synthetic',
    provenance: { pids: 'synthetic', cpuMillis: 'synthetic' },
    guards: { source: 'supervisor', observedAtMs: 100000, controls: ['timeout', 'output'] } });
  const original = structuredClone(response);
  response.observation.pool.cpuMillis = 1; f.config.pool.cpuMillis = 1; f.config.maxConcurrent = 1;
  expect(await view.capabilities()).toEqual(original);
});

it('clips lease to original configured age without renewing it on reads', async () => {
  const f = await fixture(); f.config.observationTtlMs = 50;
  const view = new CapabilityView(f.options); const first = await view.capabilities();
  expect(first.observation.expiresAtMs).toBe(100050);
  f.clock.wall += 49; f.clock.mono += 49;
  expect((await view.capabilities()).observation).toEqual(first.observation);
  f.clock.wall++; f.clock.mono++;
  await expect(view.capabilities()).rejects.toMatchObject({ status: 503 });
  expect(f.publisher.status().ready).toBe(true); // The stricter configured lease, not its publisher lease, expired.
});

it.each(['future', 'nan', 'empty-staging'] as const)('refuses %s source facts without claiming capacity', async cause => {
  const f = await fixture();
  const options = { ...f.options, wallNow: () => cause === 'future' ? 99999 : cause === 'nan' ? NaN : f.clock.wall };
  if (cause === 'empty-staging') f.config.perRun.stagingBytes = 0;
  await expect(new CapabilityView(options).capabilities()).rejects.toMatchObject({ status: 503 });
});

it.each(['guard-old', 'guard-future', 'resource-old'] as const)('refuses inconsistent %s timestamps', async cause => {
  const f = await fixture(); const frame = f.publisher.snapshot();
  if (!frame?.observation.guards) throw new Error('Missing fixture guards');
  const guards = frame.observation.guards;
  const invalid = { ...frame, observation: { ...frame.observation,
    observedAt: cause === 'resource-old' ? frame.sampleStartedAtMs - 1 : frame.observation.observedAt,
    guards: { ...guards, observedAt: cause === 'guard-old' ? frame.sampleStartedAtMs - 1
      : cause === 'guard-future' ? f.clock.wall + 1 : guards.observedAt } } };
  await expect(new CapabilityView({ ...f.options, published: () => invalid }).capabilities()).rejects.toMatchObject({ status: 503 });
});

it('binds actual policy and installed identity changes but ignores object-key insertion order', async () => {
  const f = await fixture(); const original = capacityPolicyDigest(f.config, f.catalog);
  const reversed = { ...f.config, pool: { stagingBytes: f.config.pool.stagingBytes, outputBytes: f.config.pool.outputBytes,
    pids: f.config.pool.pids, memoryBytes: f.config.pool.memoryBytes, cpuMillis: f.config.pool.cpuMillis } };
  expect(capacityPolicyDigest(reversed, f.catalog)).toBe(original);
  expect(capacityPolicyDigest({ ...f.config, maxConcurrent: 2 }, f.catalog)).not.toBe(original);
  const source = registration(); const changed = { ...source, profile: { ...source.profile, tmpfsBytes: source.profile.tmpfsBytes + 1 } };
  const other = createEngineCatalog([changed]);
  expect(other.engines[0]!.validation).toEqual(f.catalog.engines[0]!.validation);
  expect(capacityPolicyDigest(f.config, other)).not.toBe(original);
});
