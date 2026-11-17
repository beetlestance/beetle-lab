import { selectInstalledConfiguration } from '@beetle/contracts/installation-generation';
import { captureInstalledConfiguration } from '../../../agent/src/bootstrap/index.js';
import { captureInstallationRecord } from '../../../app/src/bootstrap/configuration.js';
import { capture, digest, requireInput } from './capture.js';
import type { ConfigurationGeneration } from '@beetle/contracts/installation-generation';
import type { ProvisionRequest } from '../types.js';
import { configuredEngines, engineConfiguration } from './engines.js';
import { join } from 'node:path';
import type { ProvisionResult } from '../types.js';
import type { Captured } from './capture.js';
import type { Facts } from './inspection.js';

export function paths(root: string): ProvisionResult['paths'] {
  return Object.freeze({
    installation: join(root, 'config/installation.json'),
    backendAgent: join(root, 'config/backend-agent.json'),
    agent: join(root, 'config/agent.json'),
    receipt: join(root, 'installation.json'),
    backendData: join(root, 'backend'),
    agentJournal: join(root, 'agent/journal'),
    agentStaging: join(root, 'agent/staging'),
  });
}
export const directories = [
  'config',
  'backend',
  'backend/inputs',
  'backend/inputs/staging',
  'backend/inputs/published',
  'agent',
  'agent/journal',
  'agent/staging',
] as const;
export const configNames = ['installation.json', 'backend-agent.json', 'agent.json', 'agent-token'] as const;
export function configurations(c: Captured, installationId: string, facts: Facts): Record<string, unknown> {
  const r = c.request;
  const p = paths(r.root);
  const { registrations, catalog } = configuredEngines(c, installationId, facts);
  const normal = registrations[0]!;
  const {
    manifest,
    profile,
    configVersion,
    validation: { profileId },
  } = normal;
  const engine = catalog.engines[0]!;
  const pool = r.installationValues.pool;
  const offline = r.exportEngine;
  const installedExport = catalog.engines[1];
  return {
    'installation.json': {
      id: installationId,
      version: 1,
      schemaVersion: 2,
      scope: { kind: 'installation' },
      values: r.installationValues,
    },
    'backend-agent.json': {
      version: 1,
      origin: r.agentOrigin,
      tokenFile: join(r.root, 'config/agent-token'),
      expectedInstallationId: installationId,
      storageAllocationBytes: pool.storageBytes,
      freeSpaceReserveBytes: pool.freeSpaceReserveBytes,
      profiles: [
        {
          engine: { id: manifest.engineId, imageDigest: facts.engineId, configVersion, profileId },
          installedIdentity: engine.installedIdentity,
          requiredCapabilities: manifest.capabilities,
        },
      ],
      ...(offline && installedExport
        ? {
            exportProfiles: [
              {
                sourceProfileId: offline.sourceProfileId,
                profile: {
                  engine: {
                    id: installedExport.manifest.engineId,
                    imageDigest: installedExport.profile.imageDigest,
                    configVersion: installedExport.configVersion,
                    profileId: offline.profileId,
                  },
                  installedIdentity: installedExport.installedIdentity,
                  requiredCapabilities: installedExport.manifest.capabilities,
                },
              },
            ],
          }
        : {}),
    },
    'agent.json': {
      version: 1,
      installation: {
        installationId,
        stagingRoot: p.agentStaging,
        expectedDaemonId: facts.daemonId,
        agentContainer: r.agentContainer,
        agentImageId: facts.agentId,
        user: profile.user,
        ...(r.agentIdentity ? { agentIdentity: r.agentIdentity } : {}),
      },
      dockerSocket: r.dockerSocket,
      journalDirectory: p.agentJournal,
      credentialFile: join(r.root, 'config/agent-token'),
      minimumFreeBytes: pool.freeSpaceReserveBytes,
      configuration: r.agentPolicy,
      providers: { inputRoot: join(r.root, 'backend/inputs/published'), secretBindings: [] },
      engines: registrations.map(engineConfiguration),
      listen: { host: '0.0.0.0', port: Number(new URL(r.agentOrigin).port || 80) },
    },
  };
}

export const configurationStatePath = (root: string): string => join(root, 'config/configuration-state.json');

/** Derive the committed policy through owning decoders; baseline request bindings stay unchanged. */
export function generationRequest(
  c: Captured,
  receipt: { readonly generation?: ConfigurationGeneration },
  baseline: { agent: string; installation: string },
): ProvisionRequest {
  if (!receipt.generation) return c.request;
  const agent = captureInstalledConfiguration(
    selectInstalledConfiguration(receipt, 'agent.json', baseline.agent, digest),
  );
  const installation = captureInstallationRecord(
    selectInstalledConfiguration(receipt, 'installation.json', baseline.installation, digest),
  );
  const version = (id: string) => {
    const engine = agent.catalog.engines.find((engine) => engine.validation.profileId === id);
    requireInput(engine !== undefined);
    return engine.validation.catalogVersion;
  };
  return capture(
    {
      ...c.request,
      installationValues: installation.values,
      agentPolicy: agent.configuration,
      engine: { ...c.request.engine, catalogVersion: version(c.request.engine.profileId) },
      ...(c.request.exportEngine
        ? { exportEngine: { ...c.request.exportEngine, catalogVersion: version(c.request.exportEngine.profileId) } }
        : {}),
    },
    c.context,
  ).request;
}
