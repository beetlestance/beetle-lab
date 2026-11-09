import { mkdtemp, realpath, rm, statfs } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi } from 'vitest';
import type { Capabilities, ClientResult } from '@beetle/contracts';
import type { AgentConnectionConfiguration, RunnerGateway } from '../../src/ports/runner.js';
import type { CapacitySource } from '../../src/ports/runtime.js';
import { nativeDisk } from '../../src/adapters/outbound/capacity/disk.js';
import type { DiskPort } from '../../src/adapters/outbound/capacity/disk.js';
import { openSource } from '../../src/adapters/outbound/capacity/source.js';

export const identity = { manifestId: 'k6', profileId: 'installed', catalogVersion: 1,
  manifestDigest: 'a'.repeat(64), profileDigest: 'b'.repeat(64), schemaDigest: 'c'.repeat(64) };
export function configuration(): AgentConnectionConfiguration {
  return { version: 1, origin: 'http://127.0.0.1:1', tokenFile: '/synthetic/token',
    expectedInstallationId: '12345678-1234-4234-8234-123456789abc', storageAllocationBytes: 1000000,
    freeSpaceReserveBytes: 1000, profiles: [{ engine: { id: 'k6', profileId: 'browser-alias',
      imageDigest: `sha256:${'d'.repeat(64)}`, configVersion: 1 }, installedIdentity: { ...identity },
    requiredCapabilities: ['http'] }] };
}
export function capabilities(start = 10000): Capabilities {
  return { protocolVersion: '1.0', protocolVersions: ['1.0'],
    capacity: { cpuMillis: 1000, memoryBytes: 20000, pids: 50, timeoutMs: 60000, outputBytes: 100000 },
    supportedControls: ['cpu', 'memory', 'pids', 'timeout', 'output'],
    engines: [{ id: 'k6', version: '1', imageDigest: `sha256:${'d'.repeat(64)}`, configVersion: 1,
      installedIdentity: { ...identity }, capabilities: ['http'] }],
    observation: { installationId: configuration().expectedInstallationId, daemonId: 'synthetic-daemon',
      policyDigest: 'e'.repeat(64), clock: 'local-shared-wall', source: 'docker-info+statfs',
      sampleStartedAtMs: start, observedAtMs: start + 10, expiresAtMs: start + 4000, observationTtlMs: 5000,
      pool: { cpuMillis: 4000, memoryBytes: 80000, pids: 200, outputBytes: 400000, stagingBytes: 500000 },
      perRunStagingBytes: 125000, maxConcurrent: 4,
      provenance: { cpuMillis: 'docker-info', memoryBytes: 'docker-info', pids: 'configured-policy',
        outputBytes: 'configured-policy', stagingBytes: 'configured-policy' },
      diskSource: 'statfs', freeStagingDiskBytes: 1, physicalPidCapacity: null,
      runtimeControls: ['cpu', 'memory', 'pids'],
      guards: { source: 'supervisor', observedAtMs: start + 10, controls: ['timeout', 'output'] },
      requiredSensors: ['idle', 'thermal'] } };
}
export function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
export async function fixture(overrides: Partial<DiskPort> = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'backend-capacity-')));
  const state = { now: 10100, frame: capabilities(), configuration: configuration() };
  const calls = vi.fn(async (signal?: AbortSignal): Promise<ClientResult<Capabilities>> => {
    void signal; return { ok: true, value: state.frame };
  });
  const gateway: RunnerGateway = { capabilities: calls, attempt: () => { throw new Error('unused'); }, close: vi.fn(async () => undefined) };
  const disk: DiskPort = { ...nativeDisk, ...overrides };
  let source: CapacitySource | undefined;
  return { root, state, gateway, calls, disk,
    open: async () => { source = await openSource({ dataRoot: root, configuration: state.configuration, gateway }, disk, () => state.now); return source; },
    cleanup: async () => { await source?.close(); await rm(root, { recursive: true, force: true }); },
    actual: () => statfs(root, { bigint: true }) };
}
