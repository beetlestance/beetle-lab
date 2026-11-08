import { createHash } from 'node:crypto';
import { isAbsolute, normalize } from 'node:path';
import { encodeJson, validatePrimitive } from '@beetle/contracts';
import type { EngineManifest } from '@beetle/contracts';
import { createK6ConfigSchema } from '@beetle/contracts/engine-config/k6';
import { createEngineCatalog } from '../catalog/index.js';
import type { Catalog } from '../catalog/index.js';
import type { InstallationProfile } from '../backends/docker/index.js';
import type { InstallationConfiguration } from '../staging/index.js';
import type { ProviderConfiguration } from '../providers/index.js';
import type { PoolConfiguration } from '../admission/index.js';
import { AgentConfigurationError } from './configuration-types.js';

export interface InstalledConfiguration {
  version: 1;
  installation: InstallationConfiguration;
  dockerSocket: string;
  journalDirectory: string;
  credentialFile: string;
  minimumFreeBytes: number;
  configuration: Omit<PoolConfiguration, 'profiles'>;
  providers: ProviderConfiguration;
  catalog: Catalog;
  listen: { host: string; port: number };
}
export function record(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AgentConfigurationError();
  const keys = Object.keys(value);
  if (keys.length > allowed.length || keys.some(key => !allowed.includes(key))) throw new AgentConfigurationError();
  return value as Record<string, unknown>;
}
export function absolutePath(value: unknown, maximum = 1024): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum || !isAbsolute(value)
    || normalize(value) !== value || Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
    throw new AgentConfigurationError();
  }
  return value;
}
function installedCatalog(input: unknown): Catalog {
  if (!Array.isArray(input) || input.length < 1 || input.length > 32) throw new AgentConfigurationError();
  const schema = createK6ConfigSchema(value => createHash('sha256').update(value).digest('hex'));
  const entries = input.map(raw => {
    const item = record(raw, ['manifest', 'profile', 'configVersion', 'manifestId', 'profileId', 'catalogVersion']);
    const manifest = item.manifest as EngineManifest;
    if (!manifest || manifest.engineId !== 'k6' || item.configVersion !== 1) throw new AgentConfigurationError();
    return { manifest, profile: item.profile as InstallationProfile, configVersion: 1, configSchema: schema,
      validation: { manifestId: item.manifestId as string, profileId: item.profileId as string,
        catalogVersion: item.catalogVersion as number, schemaDigest: schema.schemaDigest } };
  });
  return createEngineCatalog(entries);
}
function installation(raw: unknown): InstallationConfiguration {
  const input = record(raw, ['installationId', 'stagingRoot', 'expectedDaemonId', 'agentContainer', 'agentImageId', 'user']);
  if (!validatePrimitive('uuid', input.installationId).ok || typeof input.agentImageId !== 'string'
    || !/^sha256:[a-f0-9]{64}$/u.test(input.agentImageId)
    || typeof input.user !== 'string' || !/^[1-9][0-9]{0,8}:[1-9][0-9]{0,8}$/u.test(input.user)) throw new AgentConfigurationError();
  absolutePath(input.stagingRoot, 512);
  if (typeof input.expectedDaemonId !== 'string' || !/^[A-Za-z0-9:._-]{1,128}$/u.test(input.expectedDaemonId)
    || typeof input.agentContainer !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u.test(input.agentContainer)) throw new AgentConfigurationError();
  return input as unknown as InstallationConfiguration;
}
function listen(raw: unknown): InstalledConfiguration['listen'] {
  const input = raw === undefined ? {} : record(raw, ['host', 'port']);
  const host = input.host ?? '127.0.0.1'; const port = input.port ?? 4312;
  if (typeof host !== 'string' || !['127.0.0.1', '::1', '0.0.0.0'].includes(host)
    || typeof port !== 'number' || !Number.isSafeInteger(port) || port < 1 || port > 65535) throw new AgentConfigurationError();
  return { host, port };
}
/** Source is bounded parsed private JSON; admission remains the policy semantic validator. */
export function installedConfiguration(raw: unknown): InstalledConfiguration {
  const input = record(JSON.parse(encodeJson(raw, 262_144)) as unknown,
    ['version', 'installation', 'dockerSocket', 'journalDirectory', 'credentialFile', 'minimumFreeBytes', 'configuration', 'providers', 'engines', 'listen']);
  if (input.version !== 1 || typeof input.minimumFreeBytes !== 'number' || !Number.isSafeInteger(input.minimumFreeBytes)
    || input.minimumFreeBytes < 0) throw new AgentConfigurationError();
  const configuration = record(input.configuration,
    ['pool', 'perRun', 'controlReserve', 'headroom', 'maxConcurrent', 'maxTimeoutMs', 'observationTtlMs', 'requiredSensors', 'thermal']);
  return { version: 1, installation: installation(input.installation),
    dockerSocket: absolutePath(input.dockerSocket), journalDirectory: absolutePath(input.journalDirectory),
    credentialFile: absolutePath(input.credentialFile), minimumFreeBytes: input.minimumFreeBytes,
    configuration: configuration as unknown as InstalledConfiguration['configuration'],
    providers: input.providers as ProviderConfiguration, catalog: installedCatalog(input.engines), listen: listen(input.listen) };
}
