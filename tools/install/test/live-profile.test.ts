import { expect, it } from 'vitest';
import { K6_LIVE_METRIC_IMAGE_ENV } from '@beetle/contracts/k6-live';
import { provisionFreshInstallation } from '../index.js';
import { fixture } from './fixtures.js';
import { loadAgentConfiguration } from '../../../agent/src/bootstrap/index.js';
import { loadBackendConfiguration } from '../../../app/src/bootstrap/configuration.js';
const f = fixture();
it.each([false, true])('binds the installed profile to the inspected image capability: %s', async enabled => {
  const e = await f.setup(); const original = e.context.docker;
  const docker: typeof original = {async request(input) {
    const reply = await original.request(input);
    if (!enabled || !input.path.includes('synthetic-engine') || !reply.ok) return reply;
    return {...reply, body: {...reply.body as object, Config: {Env: ['PATH=/usr/bin', `${K6_LIVE_METRIC_IMAGE_ENV}=1`]}}};
  }};
  const result = await provisionFreshInstallation(e.request, {...e.context, docker});
  const loaded = await loadAgentConfiguration({BEETLE_AGENT_CONFIG_FILE: result.paths.agent}, f.worker());
  try {
    const engine = loaded.runtime.catalog.engines[0]!;
    expect(engine.profile.liveMetricMailbox).toBe(enabled ? true : undefined);
    const backend = await loadBackendConfiguration({BEETLE_CONFIG_FILE: result.paths.installation,
      BEETLE_AGENT_CONFIG_FILE: result.paths.backendAgent, BEETLE_DATA_DIR: result.paths.backendData,
      BEETLE_EXTERNAL_ORIGIN: e.request.externalOrigin}, f.worker());
    expect(backend.application.agent?.connection.configuration.profiles[0]?.installedIdentity).toEqual(engine.installedIdentity);
  } finally {await loaded.close();}
});
