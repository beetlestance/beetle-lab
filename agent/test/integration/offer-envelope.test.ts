import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import type { Capabilities, StagedAttempt } from '@beetle/contracts';
import { createK6ConfigSchema } from '@beetle/contracts/engine-config/k6';
import { createEngineCatalog } from '../../src/catalog/index.js';
import { createInstallationController } from '../../src/installation/index.js';
import { createAgentServer } from '../../src/transport/index.js';
import { runtimeName } from '../../src/backends/docker/index.js';
import { fixture, operation } from '../staging/fixtures.js';
import { configuration, observation, scope } from '../admission/fixtures.js';
import { controlled } from '../supervisor/fixtures.js';
import { fullOffer, hash, jsonBytes, pairedClient } from './offer-envelope-fixtures.js';

const f = fixture();
const run = promisify(execFile);
it('carries exact1MiB UTF8 config through client/catalogue/installation/reopen/Stager/actual loader+compile', async () => {
  const e = await f.environment(false, 60_000); const job = fullOffer(e.offer);
  const schema = createK6ConfigSchema(hash);
  const manifest = { ...e.options.manifest, defaultBudget: { ...job.budget }, schemas: { ...e.options.manifest.schemas, config: schema.schemaId } };
  const validation = { ...e.options.validation, schemaDigest: schema.schemaDigest };
  const catalog = createEngineCatalog([{ manifest, profile: e.options.profile, validation, configSchema: schema, configVersion: 1 }]);
  job.installedIdentity = catalog.engines[0]!.installedIdentity;
  const expected = { offerBytes: jsonBytes(job), configBytes: jsonBytes(job.config),
    offerHash: hash(JSON.stringify(job)), configHash: hash(JSON.stringify(job.config)), requests: 1, inputs: 0 };
  expect(expected.configBytes).toBe(1_048_576); expect(expected.offerBytes).toBeGreaterThan(1_048_576);
  const pool = { ...configuration(), maxTimeoutMs: job.budget.timeoutMs,
    profiles: catalog.engines.map(engine => structuredClone(engine.approved)) };
  await e.owner.admission({ kind: 'configure', configuration: pool });
  await e.owner.admission({ kind: 'observe', observation: observation(Date.now()) });
  const runtime = controlled(e.owner);
  const unused = vi.fn(() => { throw new Error('unexpected_runtime_or_provider'); });
  const installation = createInstallationController({ journal: e.owner, gate: e.options.gate, catalog, supervisor: runtime.manager,
    guard: { watch: unused }, timeout: { watch: unused }, stagerFor: unused });
  const capabilities = JSON.parse(await readFile('contracts/fixtures/valid/capabilities.json', 'utf8')) as Capabilities;
  capabilities.journalAuthority = await e.owner.journalAuthority();
  const server = createAgentServer({ credential: 'F'.repeat(64), installation, journal: e.owner, journalAuthority: capabilities.journalAuthority, capabilities: async () => capabilities });
  const key = scope(job); const headers = { authorization: `Bearer ${'F'.repeat(64)}`,
    'x-beetle-organization-id': key.organizationId, 'x-beetle-workspace-id': key.workspaceId, 'x-beetle-journal-authority': capabilities.journalAuthority, 'x-beetle-generation': '1' };
  const client = pairedClient(server, headers);
  try {
    // Independent config+1 rejection occurs before durable/provider/file/runtime effects.
    const tooLarge = fullOffer(job, 1_048_577);
    expect((await client.offer(key.attemptId, tooLarge)).ok).toBe(false);
    expect((await server.inject({ method: 'PUT', url: `/runner/v1/attempts/${key.attemptId}`, headers, payload: tooLarge })).statusCode).toBe(400);
    await expect(e.owner.get(key)).rejects.toMatchObject({ code: 'not_found' });
    expect(await readdir(e.rootPath)).toEqual(['.beetle-namespace-v1.json']); expect(unused).not.toHaveBeenCalled();
    const first = await client.offer(key.attemptId, job); expect(first.ok).toBe(true);
    const reordered = Object.fromEntries(Object.entries(job).reverse());
    expect((await client.offer(key.attemptId, reordered as typeof job))).toEqual(first);
    const conflict = await server.inject({ method: 'PUT', url: `/runner/v1/attempts/${key.attemptId}`, headers,
      payload: { ...job, intentDigest: 'f'.repeat(64) } });
    expect(conflict.statusCode).toBe(409);
    const changedConfig = await server.inject({ method: 'PUT', url: `/runner/v1/attempts/${key.attemptId}`, headers,
      payload: { ...job, config: { ...job.config, target: 'https://changed.invalid' } } });
    expect(changedConfig.statusCode).toBe(409);
    expect(unused).not.toHaveBeenCalled(); expect(runtime.backend.creates).toBe(0);
  } finally { await server.close(); await installation.close(); }
  await f.close(e.owner);
  const reopened = await f.open(e.journalPath);
  const persisted = await reopened.readOffer(key);
  expect(hash(JSON.stringify(persisted))).toBe(expected.offerHash);
  expect(jsonBytes(persisted.config)).toBe(expected.configBytes);
  await reopened.admission({ kind: 'observe', observation: observation(Date.now()) });
  const admitted = await reopened.admission({ kind: 'admit', key, sourceOrdinal: 1, now: Date.now() });
  expect(admitted).toMatchObject({ status: 'charged', staging: { offerBytes: expected.offerBytes, policyVersion: 1 } });
  const providers = { input: unusedProvider(), secret: unusedProvider() };
  const stager = e.create({ journal: reopened, manifest, validation, providers, wallNow: Date.now });
  const prepared = stager.prepare({ key, operation: operation() });
  const result = await prepared.result; await prepared.quiesced; expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  const root = join(e.rootPath, runtimeName({ ...key, installationId: e.options.profile.installationId }));
  const inputRoot = join(root, 'input'); const raw = await readFile(join(inputRoot, 'offer.json'));
  const metadata = JSON.parse(await readFile(join(inputRoot, 'staging.json'), 'utf8')) as StagedAttempt;
  expect(raw.byteLength).toBe(expected.offerBytes); expect(hash(raw)).toBe(expected.offerHash);
  expect(metadata.offerSha256).toBe(expected.offerHash);
  const compiled = await run(process.execPath, ['--import', 'tsx', 'engines/k6/test/staged-input/full-size-cli.ts',
    inputRoot, join(root, 'secrets'), manifest.engineVersion], { maxBuffer: 4096, timeout: 5000 });
  expect(JSON.parse(compiled.stdout)).toEqual(expected);
  expect(providers.input).not.toHaveBeenCalled(); expect(providers.secret).not.toHaveBeenCalled();
  await stager.close(); await f.close(reopened);
});
function unusedProvider() { return vi.fn((): never => { throw new Error('unexpected_provider'); }); }
