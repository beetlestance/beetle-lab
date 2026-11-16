import { expect, it } from 'vitest';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { generationDigest } from '@beetle/contracts/installation-generation';
import type { ConfigurationGeneration } from '@beetle/contracts/installation-generation';
import { fixture } from './fixtures.js';
import { provisionFreshInstallation } from '../index.js';
import { capture, digest } from '../src/capture.js';
import { configurations, configurationStatePath } from '../src/configuration.js';
import { inspect } from '../src/inspection.js';
import { planMemoryChange } from '../capacity/policy.js';
import { loadAgentConfiguration } from '../../../agent/src/bootstrap/index.js';
import { loadBackendConfiguration } from '../../../app/src/bootstrap/configuration.js';
import type { Receipt } from '../src/receipt.js';
const f = fixture();
async function setup() {
  const e = await f.setup(); const installed = await provisionFreshInstallation(e.request, e.context);
  const statePath = configurationStatePath(e.root);
  const receipt = JSON.parse(await readFile(statePath, 'utf8')) as Receipt;
  const settings = { id: installed.installationId, version: 1, schemaVersion: 2 as const,
    scope: { kind: 'installation' as const }, values: e.request.installationValues };
  const plan = planMemoryChange(e.request, settings, 1073741824, e.context);
  const c = capture(plan.request, e.context); const facts = await inspect(c);
  const values = configurations(c, installed.installationId, facts);
  const intent = { version: 1 as const, operationId: '00000000-0000-4000-8000-000000000002',
    installationId: installed.installationId, previousDigest: receipt.requestDigest,
    configurations: values as ConfigurationGeneration['configurations'] };
  const next = { ...receipt, generation: { ...intent, digest: generationDigest(intent, digest) } };
  const backend = () => loadBackendConfiguration({ BEETLE_CONFIG_FILE: installed.paths.installation,
    BEETLE_AGENT_CONFIG_FILE: installed.paths.backendAgent, BEETLE_DATA_DIR: installed.paths.backendData,
    BEETLE_EXTERNAL_ORIGIN: e.request.externalOrigin }, f.worker());
  const agent = () => loadAgentConfiguration({ BEETLE_AGENT_CONFIG_FILE: installed.paths.agent }, f.worker());
  return { ...e, installed, statePath, next, backend, agent };
}
it('selects the identical committed 1GiB identity in both services and retains it through baseline provisioning replay', async () => {
  const e = await setup();
  const baseline = await readFile(e.installed.paths.agent);
  await writeFile(e.statePath, JSON.stringify(e.next));
  const agent = await e.agent();
  try {
    const backend = await e.backend();
    expect(agent.runtime.configuration.perRun.memoryBytes).toBe(1073741824);
    expect(agent.runtime.catalog.engines[0]!.profile.maximumBudget.memoryBytes).toBe(1073741824);
    expect(backend.application.metadata.installation?.values.perRunCeilings.memoryBytes).toBe(1073741824);
    expect(backend.application.agent?.connection?.configuration.profiles[0]?.installedIdentity)
      .toEqual(agent.runtime.catalog.engines[0]!.installedIdentity);
  } finally { await agent.close(); }
  expect((await provisionFreshInstallation(e.request, e.context)).status).toBe('unchanged');
  expect(JSON.parse(await readFile(e.statePath, 'utf8'))).toEqual(e.next);
  expect(await readFile(e.installed.paths.agent)).toEqual(baseline);
});
it('fences both serving loaders and Compose configuration readiness during an unfinished update', async () => {
  const e = await setup(); await writeFile(e.statePath, JSON.stringify({ ...e.next, phase: 'reconfiguring' }));
  await expect(e.agent()).rejects.toThrow(); await expect(e.backend()).rejects.toThrow();
  await expect(provisionFreshInstallation(e.request, e.context)).rejects.toMatchObject({ code: 'recovery_required' });
});
it('rejects stale configuration captured before a maintenance transaction acquired the startup gates', async () => {
  const e = await setup(); const agent = await e.agent();
  try {
    const backend = await e.backend();
    await writeFile(e.statePath, JSON.stringify(e.next));
    await expect(agent.runtime.configurationCheck!()).rejects.toThrow('changed');
    await expect(backend.application.configurationCheck!()).rejects.toThrow('changed');
  } finally { await agent.close(); }
});

it('refuses installed startup and readiness when the authoritative selector is missing', async () => {
  const e = await setup(); await rm(e.statePath);
  await expect(e.agent()).rejects.toThrow(); await expect(e.backend()).rejects.toThrow();
  await expect(provisionFreshInstallation(e.request, e.context)).rejects.toMatchObject({code: 'recovery_required'});
});
it('refuses a recomputed digest over invalid configuration instead of granting ready replay', async () => {
  const e = await setup(); const intent = { ...e.next.generation,
    configurations: { ...e.next.generation.configurations, 'agent.json': { version: 1, installation: { installationId: e.installed.installationId } } } };
  const {digest: _digest, ...body} = intent; void _digest;
  const generation = {...body, digest: generationDigest(body, digest)};
  await writeFile(e.statePath, JSON.stringify({...e.next, generation}));
  await expect(provisionFreshInstallation(e.request, e.context)).rejects.toMatchObject({code: 'recovery_required'});
});
