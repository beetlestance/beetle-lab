import { K6_LIVE_METRIC_IMAGE_ENV } from '@beetle/contracts/k6-live';
import { join } from 'node:path';
import { createK6ConfigSchema } from '@beetle/contracts/engine-config/k6';
import { createEngineCatalog } from '../../../agent/src/catalog/index.js';
import type { ProvisionResult } from '../types.js';
import type { Captured } from './capture.js';
import { digest, requireInput } from './capture.js';
import type { Facts } from './inspection.js';

export function paths(root: string): ProvisionResult['paths'] {
  return Object.freeze({ installation: join(root, 'config/installation.json'), backendAgent: join(root, 'config/backend-agent.json'),
    agent: join(root, 'config/agent.json'), receipt: join(root, 'installation.json'), backendData: join(root, 'backend'),
    agentJournal: join(root, 'agent/journal'), agentStaging: join(root, 'agent/staging') });
}
export const directories = ['config', 'backend', 'backend/inputs', 'backend/inputs/staging', 'backend/inputs/published',
  'agent', 'agent/journal', 'agent/staging'] as const;
export const configNames = ['installation.json', 'backend-agent.json', 'agent.json', 'agent-token'] as const;
export function configurations(c: Captured, installationId: string, facts: Facts): Record<string, unknown> {
  const r = c.request; const p = paths(r.root); const schema = createK6ConfigSchema(digest);
  requireInput(r.engine.manifest.schemas.config === schema.schemaId);
  const manifest = { ...r.engine.manifest, imageDigest: facts.engineId };
  const profile = { installationId, imageDigest: facts.engineId, entrypoint: manifest.entrypoint,
    effectiveImage: { imageDigest: facts.engineId, environment: facts.environment, defaultRuntime: facts.defaultRuntime },
    user: `${r.uid}:${r.gid}`, stagingRoot: p.agentStaging,
    ...(facts.environment.includes(`${K6_LIVE_METRIC_IMAGE_ENV}=1`) ? {liveMetricMailbox: true} : {}),
    network: { profile: 'target-egress' as const, name: r.targetNetwork }, tmpfsBytes: r.engine.tmpfsBytes,
    maximumBudget: r.installationValues.perRunCeilings };
  const { manifestId, profileId, catalogVersion, configVersion } = r.engine;
  const catalog = createEngineCatalog([{ manifest, profile, configVersion, configSchema: schema,
    validation: { manifestId, profileId, catalogVersion, schemaDigest: schema.schemaDigest } }]);
  const engine = catalog.engines[0]!; const pool = r.installationValues.pool;
  return {
    'installation.json': { id: installationId, version: 1, schemaVersion: 2, scope: { kind: 'installation' }, values: r.installationValues },
    'backend-agent.json': { version: 1, origin: r.agentOrigin, tokenFile: join(r.root, 'config/agent-token'),
      expectedInstallationId: installationId, storageAllocationBytes: pool.storageBytes, freeSpaceReserveBytes: pool.freeSpaceReserveBytes,
      profiles: [{ engine: { id: manifest.engineId, imageDigest: facts.engineId, configVersion, profileId },
        installedIdentity: engine.installedIdentity, requiredCapabilities: manifest.capabilities }] },
    'agent.json': { version: 1, installation: { installationId, stagingRoot: p.agentStaging, expectedDaemonId: facts.daemonId,
      agentContainer: r.agentContainer, agentImageId: facts.agentId, user: profile.user }, dockerSocket: r.dockerSocket,
      journalDirectory: p.agentJournal, credentialFile: join(r.root, 'config/agent-token'), minimumFreeBytes: pool.freeSpaceReserveBytes,
      configuration: r.agentPolicy, providers: { inputRoot: join(r.root, 'backend/inputs/published'), secretBindings: [] },
      engines: [{ manifest, profile, configVersion, manifestId, profileId, catalogVersion }],
      listen: { host: '0.0.0.0', port: Number(new URL(r.agentOrigin).port || 80) } },
  };
}
