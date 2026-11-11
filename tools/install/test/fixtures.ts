import { afterEach, beforeAll } from 'vitest';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { EngineManifest } from '@beetle/contracts';
import type { InstallationSettings } from '@beetle/contracts/api';
import { createK6ConfigSchema } from '@beetle/contracts/engine-config/k6';
import type { DockerReply, DockerRequest } from '../../../agent/src/backends/docker/index.js';
import type { ProvisionContext, ProvisionRequest } from '../types.js';
import { digest } from '../src/capture.js';
import { journalWorker } from './worker-cache.js';

export const agentId = 'sha256:' + 'b'.repeat(64); export const engineId = 'sha256:' + 'c'.repeat(64);
export function fixture() {
  let worker: URL; const roots: string[] = [];
  beforeAll(async () => { worker = await journalWorker(); }, 20000);
  afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
  const response = (input: DockerRequest): DockerReply => {
    if (input.path === '/v1.47/info') return { ok: true, status: 200,
      body: { ID: 'synthetic-daemon', OSType: 'linux', Architecture: 'aarch64', DefaultRuntime: 'runc' } };
    if (input.path.startsWith('/v1.47/images/')) return { ok: true, status: 200,
      body: { Id: input.path.includes('agent') ? agentId : engineId, Os: 'linux', Architecture: 'arm64',
        Config: { Env: ['PATH=/usr/bin', 'SYNTHETIC=1'] } } };
    if (input.path === '/v1.47/networks/beetle-synthetic-target') return { ok: true, status: 200, body: { Name: 'beetle-synthetic-target' } };
    throw new Error('Unexpected read-only fixture path');
  };
  return { worker: () => new URL(worker.href), response, async setup() {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'w312-install-'))); roots.push(root);
    const settings = JSON.parse(await readFile('contracts/fixtures/api/valid/installation-settings.json', 'utf8')) as InstallationSettings;
    const values = settings.values;
    const manifest = JSON.parse(await readFile('contracts/fixtures/valid/manifest.json', 'utf8')) as EngineManifest;
    manifest.schemas.config = createK6ConfigSchema(digest).schemaId;
    manifest.defaultBudget = { ...values.perRunCeilings }; manifest.minimumBudget = { ...values.perRunCeilings };
    const vector = { cpuMillis: 4000, memoryBytes: 4294967296, pids: 512, outputBytes: 1073741824, stagingBytes: 20_000_000 };
    const zero = { cpuMillis: 0, memoryBytes: 0, pids: 0, outputBytes: 0, stagingBytes: 0 };
    const request: ProvisionRequest = { root, uid: process.getuid!(), gid: process.getgid!(), externalOrigin: 'https://synthetic.invalid',
      agentOrigin: 'http://127.0.0.1:4312', dockerSocket: join(root, 'synthetic.sock'), agentContainer: 'synthetic-agent',
      agentImage: 'synthetic-agent:v1', engineImage: 'synthetic-engine:v1', targetNetwork: 'beetle-synthetic-target', installationValues: values,
      agentPolicy: { pool: vector, perRun: { ...vector }, controlReserve: zero, headroom: { ...zero }, maxConcurrent: 2,
        maxTimeoutMs: 30000, observationTtlMs: 1000, requiredSensors: [] },
      engine: { manifest, manifestId: 'k6-v1', profileId: 'k6-local', catalogVersion: 1, configVersion: 1, tmpfsBytes: 1048576 } };
    const calls: DockerRequest[] = [];
    const controller = new AbortController();
    const context: ProvisionContext = { signal: controller.signal, deadline: performance.now() + 30000,
      agentWorkerUrl: new URL(worker.href), backendWorkerUrl: new URL(worker.href),
      docker: { async request(input) { calls.push(input); return response(input); } } };
    return { root, request, context, calls, controller };
  } };
}
