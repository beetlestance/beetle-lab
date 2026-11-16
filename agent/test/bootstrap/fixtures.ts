import { afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { createConfigSchema } from '@beetle/contracts/engine-config';
import { createEngineCatalog } from '../../src/catalog/index.js';
import { prepareRuntime, runtimeName } from '../../src/backends/docker/index.js';
import type { DockerReply, DockerTransport } from '../../src/backends/docker/index.js';
import type { AgentRuntime, AgentRuntimeOptions } from '../../src/bootstrap/index.js';
import { installationStatePath } from '../../src/bootstrap/index.js';
import { initializeInstallationState } from '../../src/installation-state/index.js';
import { FakeDocker } from '../backends/docker/fixtures.js';
import { fixture as stagingFixture } from '../staging/fixtures.js';
import { configuration } from '../admission/fixtures.js';

export const credential = 'R'.repeat(64);
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export function fixture() {
  const f = stagingFixture(); const runtimes: AgentRuntime[] = [];
  afterEach(async () => { await Promise.allSettled(runtimes.splice(0).map(runtime => runtime.close())); });
  return { ...f, keep(runtime: AgentRuntime) { runtimes.push(runtime); return runtime; }, async setup() {
    const e = await f.environment(false); const journalPath = await realpath(e.journalPath);
    const journalAuthority = await e.owner.journalAuthority();
    const initializer = initializeInstallationState(installationStatePath(journalPath));
    try { initializer.complete(journalAuthority); } finally { initializer.close(); }
    await f.close(e.owner);
    const offer = { ...e.offer, budget: { ...e.offer.budget, timeoutMs: 5000, outputBytes: 65_536 } };
    const schema = createConfigSchema({ schemas: [{ $id: e.options.manifest.schemas.config, type: 'object' }],
      schemaId: e.options.manifest.schemas.config, digest });
    const manifest = { ...e.options.manifest, defaultBudget: { ...offer.budget }, minimumBudget: { ...offer.budget } };
    const profile = { ...e.options.profile, maximumBudget: { ...offer.budget } };
    const catalog = createEngineCatalog([{ manifest, profile, configVersion: 1, configSchema: schema,
      validation: { ...e.options.validation, schemaDigest: schema.schemaDigest } }]);
    offer.installedIdentity = catalog.engines[0]!.installedIdentity;
    const name = runtimeName({ ...offer, installationId: profile.installationId, generation: 1 });
    const base = join(e.rootPath, name);
    const prepared = prepareRuntime({ offer, manifest, profile, generation: 1,
      staged: { input: join(base, 'input'), output: join(base, 'output'), secrets: join(base, 'secrets') } });
    if (!prepared.ok) throw new Error(prepared.reason);
    const daemon = new FakeDocker(prepared.value);
    const transport: DockerTransport = { async request(input): Promise<DockerReply> {
      if (input.path.endsWith(`/${e.configuration.agentContainer}/json`)) return e.transport.request(input);
      if (input.path === `/v1.47/images/${profile.imageDigest}/json`) return { ok: true, status: 200,
        body: { Id: profile.imageDigest, Os: 'linux', Architecture: 'arm64', Config: { Env: profile.effectiveImage.environment } } };
      const response = await daemon.request(input);
      if (input.path === '/v1.47/info' && response.ok) return { ...response,
        body: { ...(response.body as object), ID: e.configuration.expectedDaemonId, Architecture: 'aarch64', NCPU: 14, MemTotal: 16 * 1024 ** 3 } };
      return response;
    } };
    const config = configuration(); config.pool.outputBytes = 131_072; config.perRun.outputBytes = 131_072; config.maxTimeoutMs = 5000;
    const options: AgentRuntimeOptions = { journal: { path: journalPath, workerUrl: f.workerUrl() },
      installation: e.configuration, transport, catalog, configuration: config, providers: e.options.providers,
      credential, minimumFreeBytes: 0 };
    const headers = { authorization: `Bearer ${credential}`, 'x-beetle-organization-id': offer.organizationId,
      'x-beetle-workspace-id': offer.workspaceId, 'x-beetle-journal-authority': journalAuthority, 'x-beetle-generation': '1' };
    return { ...e, journalPath, journalAuthority, offer, options, headers, daemon, output: join(base, 'output') };
  } };
}
