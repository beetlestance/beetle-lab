import { expect, it } from 'vitest';
import { validate } from '@beetle/contracts';
import { validateApi } from '@beetle/contracts/api';
import { createK6ConfigSchema } from '@beetle/contracts/engine-config/k6';
import { createStarterRequest } from '../starter.js';
import type { StarterOptions } from '../starter.js';
import { digest } from '../src/capture.js';

const options: StarterOptions = {
  root: '/synthetic/starter', uid: process.getuid!(), gid: process.getgid!(),
  externalOrigin: 'https://synthetic.invalid', agentOrigin: 'http://agent:4312', dockerSocket: '/run/docker.sock',
  agentContainer: 'synthetic-agent', agentImage: 'synthetic-agent:v1', engineImage: 'synthetic-engine:v1', targetNetwork: 'synthetic-target',
};

it('ships exact editable settings and admission policy independently of host capacity', () => {
  const r = createStarterRequest(options); const MiB = 1048576;
  const budget = { cpuMillis: 1000, memoryBytes: 512 * MiB, pids: 128, timeoutMs: 300000, outputBytes: 64 * MiB };
  expect(r.installationValues).toEqual({
    pool: { cpuMillis: 2000, memoryBytes: 1024 * MiB, pids: 256, outputBytes: 128 * MiB, concurrency: 2,
      storageBytes: 2048 * MiB, freeSpaceReserveBytes: 256 * MiB }, perRunCeilings: budget,
    supportedProfiles: ['k6-local'], runDefaults: { engineProfile: 'k6-local', budget }, retention: { mode: 'manual' },
  });
  expect(r.agentPolicy).toEqual({
    pool: { cpuMillis: 2000, memoryBytes: 1024 * MiB, pids: 256, outputBytes: 128 * MiB, stagingBytes: 128 * MiB },
    perRun: { cpuMillis: 1000, memoryBytes: 512 * MiB, pids: 128, outputBytes: 64 * MiB, stagingBytes: 64 * MiB },
    controlReserve: { cpuMillis: 600, memoryBytes: 576 * MiB, pids: 160, outputBytes: 0, stagingBytes: 0 },
    headroom: { cpuMillis: 250, memoryBytes: 128 * MiB, pids: 16, outputBytes: 0, stagingBytes: 0 },
    maxConcurrent: 2, maxTimeoutMs: 300000, observationTtlMs: 1000, requiredSensors: [],
  });
  expect(validateApi('InstallationValues', r.installationValues).ok).toBe(true);
});

it('ships the actual schema and explicit nonexecutable image template', () => {
  const r = createStarterRequest(options); const manifest = r.engine.manifest;
  expect(r.engine).toMatchObject({ manifestId: 'k6-v1', profileId: 'k6-local', catalogVersion: 1, configVersion: 1, tmpfsBytes: 16777216 });
  expect(manifest).toEqual({
    engineId: 'k6', engineVersion: '2.2.0', imageDigest: 'sha256:' + '0'.repeat(64), protocolVersion: '1.0',
    protocolRange: { minimum: '1.0', maximum: '1.0' },
    schemas: { config: createK6ConfigSchema(digest).schemaId, result: 'https://beetle-lab.dev/contracts/runner/v1/engine-result' },
    capabilities: ['http'], supportedControls: ['cpu', 'memory', 'pids', 'timeout', 'output'],
    defaultBudget: r.installationValues.runDefaults.budget,
    minimumBudget: { cpuMillis: 1000, memoryBytes: 536870912, pids: 128, timeoutMs: 1, outputBytes: 1 },
    backends: ['docker'], network: { required: true, profile: 'target-egress' },
    entrypoint: { executable: 'node', arguments: ['/beetle/bootstrap/main.js'] },
    phases: ['validate', 'prepare', 'execute', 'collect', 'seal'].map(phase => ({ phase, timeoutMs: 5000, workUnits: 100, outputBytes: 4194304 })),
  });
  expect(validate('EngineManifest', manifest).ok).toBe(true);
});

it('returns detached editable data with no shared nested defaults', () => {
  const input = { ...options }; const first = createStarterRequest(input);
  input.root = '/synthetic/changed'; first.installationValues.perRunCeilings.cpuMillis = 1;
  first.engine.manifest.capabilities.push('changed'); first.agentPolicy.pool.cpuMillis = 1;
  expect(first.root).toBe(options.root);
  expect(createStarterRequest(options).engine.manifest.capabilities).toEqual(['http']);
  expect(first.installationValues.runDefaults.budget.cpuMillis).toBe(1000);
  expect(createStarterRequest(options).agentPolicy.pool.cpuMillis).toBe(2000);
});

it.each([
  { extra: true }, { root: '/' }, { root: '/synthetic/../other' }, { root: '/synthetic/\n' },
  { root: 'relative' }, { root: '/'.concat('a'.repeat(400)) }, { uid: 0 }, { gid: 0 }, { uid: 1.5 }, { gid: 1e10 },
  { uid: process.getuid!() + 1 }, { gid: process.getgid!() + 1 }, { uid: null }, { gid: '1' }, { externalOrigin: 'https://user:secret@synthetic.invalid' },
  { externalOrigin: 'https://synthetic.invalid/' }, { externalOrigin: 'file:///tmp/x' }, { agentOrigin: 'https://agent' },
  { agentOrigin: 'http://agent/path' }, { dockerSocket: '/run/../socket' }, { agentContainer: '-bad' },
  { targetNetwork: 'a'.repeat(129) }, { agentImage: 'bad?image' }, { engineImage: 'bad image' },
  { agentImage: 'a'.repeat(300000) }, { engineImage: {} },
])('rejects malformed closed deployment fields %j', change => {
  expect(() => createStarterRequest({ ...options, ...change } as StarterOptions)).toThrow(expect.objectContaining({ code: 'invalid_input' }));
});

it('rejects missing fields, nonobjects, accessors, cycles and non-JSON values without invoking accessors', () => {
  const missing: Record<string, unknown> = { ...options }; delete missing.root;
  const accessor = { ...options }; let invoked = false;
  Object.defineProperty(accessor, 'root', { enumerable: true, get() { invoked = true; return options.root; } });
  const cyclic = { ...options, extra: {} }; cyclic.extra = cyclic;
  for (const value of [null, [], missing, accessor, cyclic, { ...options, uid: NaN }, { ...options, gid: Infinity }]) {
    expect(() => createStarterRequest(value as StarterOptions)).toThrow(expect.objectContaining({ code: 'invalid_input' }));
  }
  expect(invoked).toBe(false);
});
