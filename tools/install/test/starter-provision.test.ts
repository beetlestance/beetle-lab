import { expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createStarterRequest } from '../starter.js';
import { provisionFreshInstallation } from '../index.js';
import { loadAgentConfiguration } from '../../../agent/src/bootstrap/index.js';
import { loadBackendConfiguration } from '../../../app/src/bootstrap/configuration.js';
import { fixture, engineId } from './fixtures.js';

const f = fixture();
it('provisions the generated request through actual catalogue/schema, Journal and private loaders using synthetic daemon facts', async () => {
  const e = await f.setup();
  const { root, uid, gid, externalOrigin, agentOrigin, dockerSocket, agentContainer, agentImage, engineImage, targetNetwork } = e.request;
  const request = createStarterRequest({ root, uid, gid, externalOrigin, agentOrigin, dockerSocket, agentContainer, agentImage, engineImage, targetNetwork });
  const result = await provisionFreshInstallation(request, e.context);
  expect(result.status).toBe('created'); expect(e.calls.map(call => call.method)).toEqual(['GET', 'GET', 'GET', 'GET']);
  expect(request.engine.manifest.imageDigest).toBe('sha256:' + '0'.repeat(64));
  const agent = await loadAgentConfiguration({ BEETLE_AGENT_CONFIG_FILE: result.paths.agent }, f.worker());
  try {
    const engine = agent.runtime.catalog.engines[0]!;
    expect(engine.manifest.imageDigest).toBe(engineId); expect(engine.profile.imageDigest).toBe(engineId);
    expect(engine.manifest.schemas.config).toBe(request.engine.manifest.schemas.config);
    expect(engine.profile.maximumBudget).toEqual(request.installationValues.perRunCeilings);
    const backend = await loadBackendConfiguration({ BEETLE_CONFIG_FILE: result.paths.installation,
      BEETLE_AGENT_CONFIG_FILE: result.paths.backendAgent, BEETLE_DATA_DIR: result.paths.backendData,
      BEETLE_EXTERNAL_ORIGIN: externalOrigin }, f.worker());
    expect(backend.application.agent?.connection?.configuration.profiles[0]?.installedIdentity).toEqual(engine.installedIdentity);
    const installed = JSON.parse(await readFile(result.paths.agent, 'utf8')) as { configuration: unknown };
    expect(installed.configuration).toEqual(request.agentPolicy);
    const settings = JSON.parse(await readFile(result.paths.installation, 'utf8')) as { values: unknown };
    expect(settings.values).toEqual(request.installationValues);
  } finally { await agent.close(); }
});
