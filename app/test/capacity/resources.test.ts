import { chmod, mkdir, rename, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Capabilities } from '@beetle/contracts';
import { openCapacitySource } from '../../src/adapters/outbound/capacity/index.js';
import { capabilities, configuration, fixture } from './fixture.js';

describe('backend capacity resource and identity boundaries', () => {
  it('uses its actual pinned filesystem, configured totals and alias independently of staging free bytes', async () => {
    const f = await fixture();
    try {
      const source = await openCapacitySource({ dataRoot: f.root, configuration: f.state.configuration, gateway: f.gateway });
      // Public factory clock is real; use a real-time original capability too.
      f.state.frame = capabilities(Date.now() - 100);
      const result = await source.sample();
      expect(result?.ceilings).toEqual({ pool: { cpuMillis: 4000, memoryBytes: 80000, pids: 200,
        outputBytes: 400000, concurrency: 4, storageBytes: Math.min(1000000, Number((await f.actual()).blocks * (await f.actual()).bsize)),
        freeSpaceReserveBytes: 1000 }, perRun: { cpuMillis: 1000, memoryBytes: 20000, pids: 50,
        timeoutMs: 60000, outputBytes: 100000 }, supportedProfiles: ['browser-alias'] });
      await source.close(); expect(f.gateway.close).not.toHaveBeenCalled();
    } finally { await f.cleanup(); }
  });
  it('clips allocation to filesystem total, without substituting current available bytes', async () => {
    const f = await fixture(); const actual = await f.actual();
    f.disk.statfs = async () => ({ ...actual, bsize: 100n, blocks: 5000n, bavail: 20n });
    try {
      const result = await (await f.open()).sample();
      expect(result?.ceilings.pool.storageBytes).toBe(500000);
      expect(result?.ceilings.pool.freeSpaceReserveBytes).toBe(1000);
    } finally { await f.cleanup(); }
  });
  it.each([0n, 10n])('refuses own available space at/below reserve (%s blocks)', async bavail => {
    const f = await fixture(); const actual = await f.actual();
    f.disk.statfs = async () => ({ ...actual, bsize: 100n, blocks: 5000n, bavail });
    try { expect(await (await f.open()).sample()).toBeNull(); } finally { await f.cleanup(); }
  });
  it.each([
    { bsize: 0n }, { bsize: -1n }, { blocks: -1n }, { bavail: -1n },
    { blocks: BigInt(Number.MAX_SAFE_INTEGER), bsize: 2n }, { bavail: BigInt(Number.MAX_SAFE_INTEGER), bsize: 2n },
    { blocks: 1n, bavail: 2n },
  ])('rejects unsafe/negative statfs facts %s', async changed => {
    const f = await fixture(); const actual = await f.actual();
    f.disk.statfs = async () => ({ ...actual, ...changed });
    try { expect(await (await f.open()).sample()).toBeNull(); } finally { await f.cleanup(); }
  });
  const invalid: [string, (frame: Capabilities) => void][] = [
    ['installation', value => { value.observation.installationId = '22345678-1234-4234-8234-123456789abc'; }],
    ['image', value => { value.engines[0]!.imageDigest = `sha256:${'f'.repeat(64)}`; }],
    ['engine', value => { value.engines[0]!.id = 'other'; }],
    ['configVersion', value => { value.engines[0]!.configVersion = 2; }],
    ['required capability', value => { value.engines[0]!.capabilities = []; }],
    ['duplicate installed entry', value => { value.engines.push(structuredClone(value.engines[0]!)); }],
    ['supported control', value => { value.supportedControls.pop(); }],
    ['duplicate control', value => { value.supportedControls[0] = 'memory'; }],
    ['actual CPU control', value => { value.observation.runtimeControls.shift(); }],
    ['actual output guard', value => { value.observation.guards.controls.pop(); }],
    ['CPU provenance', value => { value.observation.provenance.cpuMillis = 'synthetic'; }],
    ['RAM provenance', value => { value.observation.provenance.memoryBytes = 'synthetic'; }],
    ['PID provenance', value => { value.observation.provenance.pids = 'synthetic'; }],
    ['output provenance', value => { value.observation.provenance.outputBytes = 'synthetic'; }],
    ['staging provenance', value => { value.observation.provenance.stagingBytes = 'synthetic'; }],
    ['disk provenance', value => { value.observation.diskSource = 'synthetic'; }],
    ['per-run pool', value => { value.capacity.cpuMillis = 4001; }],
    ['per-run staging pool', value => { value.observation.perRunStagingBytes = 500001; }],
    ['future resources', value => { value.observation.observedAtMs = 10101; }],
    ['resources before start', value => { value.observation.observedAtMs = 9999; }],
    ['future guard', value => { value.observation.guards.observedAtMs = 10101; }],
    ['guard before start', value => { value.observation.guards.observedAtMs = 9999; }],
    ['expiry exceeds TTL', value => { value.observation.expiresAtMs = 15001; }],
  ];
  for (const key of ['manifestId', 'profileId', 'manifestDigest', 'profileDigest', 'schemaDigest'] as const) {
    invalid.push([`identity ${key}`, value => { value.engines[0]!.installedIdentity[key] = key.endsWith('Digest') ? 'f'.repeat(64) : 'other'; }]);
  }
  invalid.push(['identity catalogVersion', value => { value.engines[0]!.installedIdentity.catalogVersion = 2; }]);
  it.each(invalid)('refuses %s', async (_name, mutate) => {
    const f = await fixture(); mutate(f.state.frame);
    try { expect(await (await f.open()).sample()).toBeNull(); } finally { await f.cleanup(); }
  });
  it('keeps optional missing or stale sensors outside capacity display readiness', async () => {
    const f = await fixture();
    f.state.frame.observation.idle = { source: 'unavailable', observedAtMs: 0, value: null };
    f.state.frame.observation.thermal = { source: 'unavailable', observedAtMs: 0, celsius: null };
    try { expect(await (await f.open()).sample()).not.toBeNull(); } finally { await f.cleanup(); }
  });
  it('rejects root replacement before or during statfs', async () => {
    const f = await fixture(); const old = `${f.root}-old`;
    try {
      const source = await f.open();
      f.disk.statfs = async () => {
        await rename(f.root, old); await mkdir(f.root, { mode: 0o700 }); return f.actual();
      };
      expect(await source.sample()).toBeNull();
      expect(await source.sample()).toBeNull();
    } finally { await f.cleanup(); await rm(old, { recursive: true, force: true }); }
  });
  it('rejects mode drift and symlink roots', async () => {
    const f = await fixture(); const link = join(f.root, 'link');
    try {
      await symlink(f.root, link);
      await expect(openCapacitySource({ dataRoot: link, configuration: f.state.configuration, gateway: f.gateway })).rejects.toThrow('Capacity source unavailable');
      const source = await f.open(); await chmod(f.root, 0o750);
      expect(await source.sample()).toBeNull();
    } finally { await chmod(f.root, 0o700); await f.cleanup(); }
  });
  it('captures configuration privately', async () => {
    const f = await fixture();
    try {
      const source = await f.open(); f.state.configuration.profiles[0]!.engine.profileId = 'changed';
      expect((await source.sample())?.ceilings.supportedProfiles).toEqual(['browser-alias']);
    } finally { await f.cleanup(); }
  });
  it.each([
    { storageAllocationBytes: 0 }, { freeSpaceReserveBytes: -1 }, { freeSpaceReserveBytes: 1000000 },
    { profiles: [] }, { profiles: [configurationPin(), configurationPin()] },
    { profiles: [configurationPin(), { ...configurationPin(), engine: { ...configurationPin().engine, profileId: 'second' } }] },
  ])('rejects invalid/ambiguous captured policy %s', async changed => {
    const f = await fixture(); f.state.configuration = { ...f.state.configuration, ...changed };
    try { await expect(f.open()).rejects.toThrow('Capacity source unavailable'); } finally { await f.cleanup(); }
  });
});
function configurationPin() { return structuredClone(configuration().profiles[0]!); }
