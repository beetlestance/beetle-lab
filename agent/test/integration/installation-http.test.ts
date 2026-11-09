import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { sealEngineResult } from '@beetle/contracts';
import type { Capabilities, ControlEvent, EngineResult } from '@beetle/contracts';
import { createK6ConfigSchema } from '@beetle/contracts/engine-config/k6';
import { createEngineCatalog } from '../../src/catalog/index.js';
import { createInstallationController } from '../../src/installation/index.js';
import { createTimeoutGuard } from '../../src/timeout/index.js';
import { createObservationPublisher, createResourceObserver } from '../../src/observation/index.js';
import { resourceTransport } from './resource-fixtures.js';
import { createAgentServer } from '../../src/transport/index.js';
import { createScheduler } from '../../src/scheduler/index.js';
import { createOutputGuard } from '../../src/guard/index.js';
import type { InstallationController } from '../../src/installation/index.js';
import { runtimeName } from '../../src/backends/docker/index.js';
import { fixture, operation } from '../staging/fixtures.js';
import { controlled, clock, scope } from '../supervisor/fixtures.js';
import { configuration } from '../admission/fixtures.js';

const f = fixture();
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
it.each(['manual', 'scheduled', 'output_limit'] as const)('composes authenticated offer through staging verification and release (%s)', async mode => {
  const e = await f.environment(false); const time = clock(); const runtime = controlled(e.owner, time);
  const schema = createK6ConfigSchema(digest); e.offer.inputs = []; e.offer.budget.outputBytes = 65_536;
  e.offer.config = { version: 1, target: 'https://synthetic.invalid', datasets: [], secrets: [],
    requests: [{ id: 'read', name: 'read', method: 'GET', path: '/', query: {}, headers: {},
      assertions: [{ id: 'required', required: true, kind: 'statusEq', value: 200 }] }],
    loadPlan: { version: 1, scenarios: [{ id: 'main', name: 'main', executor: 'per-vu-iterations',
      startTime: '0s', gracefulStop: '0s', vus: 1, iterations: 1, maxDuration: '1s' }], slos: [] },
    selections: [{ scenarioId: 'main', entries: [{ requestId: 'read', weight: 1, wait: { durationMs: 0, jitterMs: 0 } }] }] };
  const manifest = { ...e.options.manifest, schemas: { ...e.options.manifest.schemas, config: schema.schemaId },
    defaultBudget: { ...e.offer.budget } };
  const profile = { ...e.options.profile, maximumBudget: { ...e.offer.budget } };
  const validation = { ...e.options.validation, schemaDigest: schema.schemaDigest };
  const catalog = createEngineCatalog([{ manifest, profile, validation, configSchema: schema, configVersion: 1 }]);
  e.offer.installedIdentity = catalog.engines[0]!.installedIdentity;
  const config = configuration(); config.pool.outputBytes = 131_072; config.perRun.outputBytes = 131_072;
  await e.owner.admission({ kind: 'configure', configuration: { ...config,
    profiles: catalog.engines.map(engine => structuredClone(engine.approved)) } });
  time.advance(1);
  const stager = e.create({ manifest, profile, validation, wallNow: time.wall });
  const guard = createOutputGuard({ root: e.options.root, minimumFreeBytes: 0, intervalMs: 50, ttlMs: 5000,
    stop: (key, reason) => installation.stop(key, reason) });
  const timeout = createTimeoutGuard({ wallNow: time.wall, stop: (key, reason) => installation.stop(key, reason) });
  const installation: InstallationController = createInstallationController({ journal: e.owner, supervisor: runtime.manager, catalog, guard, timeout,
    stagerFor: () => stager, wallNow: time.wall });
  timeout.start();
  guard.start();
  const observer = createResourceObserver({ root: e.options.root, transport: resourceTransport(), configuration: config, wallNow: time.wall });
  const publisher = createObservationPublisher({ journal: e.owner, observer, output: guard, timeout,
    intervalMs: 50, ttlMs: 5000, wallNow: time.wall });
  publisher.start();
  const scheduler = createScheduler({ journal: e.owner, installation, intervalMs: 50 });
  const capabilities = JSON.parse(await readFile('contracts/fixtures/valid/capabilities.json', 'utf8')) as Capabilities;
  const server = createAgentServer({ credential: 'I'.repeat(64), installation, journal: e.owner, capabilities: async () => capabilities });
  const key = scope(e.offer); const path = `/runner/v1/attempts/${key.attemptId}`;
  const headers = { authorization: `Bearer ${'I'.repeat(64)}`, 'x-beetle-organization-id': key.organizationId,
    'x-beetle-workspace-id': key.workspaceId, 'x-beetle-generation': '1' };
  try {
    expect(await publisher.initial).toEqual({ ready: true });
    const accepted = await server.inject({ method: 'PUT', url: path, headers, payload: e.offer });
    expect(accepted.statusCode).toBe(202); expect(accepted.json()).toMatchObject({ state: 'offered', generation: 1 });
    if (mode === 'manual') expect(await installation.drive(key, operation())).toMatchObject({ kind: 'runtime' });
    else {
      scheduler.start();
      await vi.waitFor(() => { expect(runtime.backend.starts).toBe(1); }, { timeout: 5000, interval: 25 });
    }
    expect(runtime.backend.creates).toBe(1); expect(runtime.backend.starts).toBe(1);
    const directory = join(e.rootPath, runtimeName({ ...key, installationId: profile.installationId }), 'output');
    if (mode === 'output_limit') {
      // Runtime/collection evidence must be later than the durable launch settlement.
      time.advance(1);
      await writeFile(join(directory, 'overflow.bin'), Buffer.alloc(65_537), { mode: 0o600 });
      await vi.waitFor(async () => {
        expect((await installation.inspect(key)).allocation).toMatchObject({ status: 'released' });
      }, { timeout: 5000, interval: 25 });
      expect(runtime.backend.kills).toBeGreaterThan(0); expect(runtime.backend.starts).toBe(1);
      expect((await server.inject({ url: path, headers })).json()).toMatchObject({ exitEvidence: { reason: 'output_limit' } });
      return;
    }
    const original = JSON.parse(await readFile('contracts/fixtures/valid/passed-result.json', 'utf8')) as EngineResult;
    const { seal: _seal, ...body } = original; void _seal;
    const sealed = sealEngineResult({ ...body, ...key, artifacts: [], thresholds: [],
      requiredAssertions: { required: 1, passed: 1, failed: 0, unknown: 0 } }, '2026-01-01T00:00:00Z', digest);
    if (!sealed.ok) throw new Error(sealed.code);
    const event: ControlEvent = { version: '1.0', ...key, seq: 1, phase: 'seal', kind: 'engine.result',
      observedAt: '2026-01-01T00:00:00Z', payload: sealed.value };
    await writeFile(join(directory, 'engine-result.json'), JSON.stringify(sealed.value), { mode: 0o600 });
    await writeFile(join(directory, 'control.ndjson'), JSON.stringify(event) + '\n', { mode: 0o600 });
    runtime.backend.observation = runtime.backend.known('exited').value; time.advance(1);
    if (mode === 'manual') {
      expect(await installation.drive(key, operation())).toEqual({ kind: 'control', events: 1 });
      expect(await installation.drive(key, operation())).toEqual({ kind: 'awaiting_release', collection: 'finished' });
      expect(await installation.drive(key, operation())).toEqual({ kind: 'released', collection: 'finished' });
    } else {
      await vi.waitFor(async () => {
        expect((await installation.inspect(key)).allocation).toMatchObject({ status: 'released' });
      }, { timeout: 5000, interval: 25 });
      expect(scheduler.status().lastError).toBeNull();
    }
    const snapshot = await server.inject({ url: path, headers });
    expect(snapshot.statusCode).toBe(200); expect(snapshot.json()).toMatchObject({ state: 'exited', result: sealed.value });
    const final = await installation.inspect(key);
    expect(final.allocation).toMatchObject({ status: 'released', releaseEvidence: { collection: { state: 'finished' } } });
    expect((await server.inject({ url: `${path}/events?after=0`, headers })).json().events).toHaveLength(4);
    expect(runtime.backend.starts).toBe(1);
  } finally {
    await server.close(); await scheduler.close(); await installation.close();
    await publisher.close(); await observer.close(); await guard.close(); await timeout.close();
  }
});
