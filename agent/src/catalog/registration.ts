import { validate } from '@beetle/contracts';
import type { EngineManifest, Offer } from '@beetle/contracts';
import { isConfigSchema } from '@beetle/contracts/engine-config';
import { MAX_ENGINE_PROFILES } from '../admission/index.js';
import type { ValidationIdentity } from '../admission/index.js';
import type { InstallationProfile } from '../backends/docker/index.js';
import { CatalogError } from './types.js';
import type { EngineRegistration, InstalledEngine } from './types.js';
import { freeze, permitsRuntime, selector, snapshot } from './offer.js';

const budgetKeys = ['cpuMillis', 'memoryBytes', 'pids', 'timeoutMs', 'outputBytes'] as const;
function requireValid(condition: unknown): asserts condition {
  if (!condition) throw new CatalogError('invalid_registration');
}
function field(input: unknown, name: string): unknown {
  requireValid(input !== null && typeof input === 'object');
  const descriptor = Object.getOwnPropertyDescriptor(input, name);
  requireValid(descriptor && 'value' in descriptor);
  return descriptor.value;
}
function positive(input: unknown): boolean { return Number.isSafeInteger(input) && (input as number) > 0; }
function identity(input: Omit<ValidationIdentity, 'configDigest'>): void {
  requireValid(input && typeof input === 'object' && !Array.isArray(input));
  requireValid(Object.keys(input).sort().join(',') === 'catalogVersion,manifestId,profileId,schemaDigest');
  for (const value of [input.manifestId, input.profileId]) {
    requireValid(typeof value === 'string' && value.length > 0 && value.length <= 128);
  }
  requireValid(typeof input.schemaDigest === 'string' && /^[a-f0-9]{64}$/.test(input.schemaDigest));
  requireValid(positive(input.catalogVersion));
}
function probe(engine: EngineRegistration, budget: Offer['budget']): Offer {
  return { protocolVersion: '1.0', organizationId: '00000000-0000-4000-8000-000000000001',
    workspaceId: '00000000-0000-4000-8000-000000000002', attemptId: '00000000-0000-4000-8000-000000000003',
    intentDigest: '0'.repeat(64), engine: { id: engine.manifest.engineId,
      imageDigest: engine.manifest.imageDigest, configVersion: engine.configVersion }, inputs: [], budget,
    executionPolicy: { mode: 'parallel', preferIdle: false }, requiredCapabilities: [], secretReferences: [], config: {} };
}
function registration(input: unknown): InstalledEngine {
  const configSchema: unknown = field(input, 'configSchema');
  requireValid(isConfigSchema(configSchema));
  const manifest = snapshot<EngineManifest>(field(input, 'manifest'), 65_536);
  const profile = snapshot<InstallationProfile>(field(input, 'profile'), 65_536);
  const validation = snapshot<EngineRegistration['validation']>(field(input, 'validation'), 4096);
  const configVersion = field(input, 'configVersion');
  requireValid(positive(configVersion) && validate('EngineManifest', manifest).ok);
  identity(validation);
  requireValid(manifest.schemas.config === configSchema.schemaId && validation.schemaDigest === configSchema.schemaDigest);
  requireValid(['cpu', 'memory', 'pids', 'timeout', 'output'].every(control => manifest.supportedControls.includes(control as 'cpu')));
  const engine: EngineRegistration = { manifest, profile, validation, configVersion: configVersion as number, configSchema };
  requireValid(permitsRuntime(probe(engine, manifest.minimumBudget), engine));
  requireValid(permitsRuntime(probe(engine, manifest.defaultBudget), engine));
  requireValid(budgetKeys.every(key => manifest.defaultBudget[key] >= manifest.minimumBudget[key]));
  return freeze({ ...engine, approved: { ...validation, engineId: manifest.engineId, imageDigest: manifest.imageDigest,
    configVersion: engine.configVersion, minimum: { ...manifest.minimumBudget, stagingBytes: 0 },
    capabilities: [...manifest.capabilities], controls: [...manifest.supportedControls] } });
}
function consistent(engines: readonly InstalledEngine[]): void {
  const first = engines[0]; requireValid(first);
  const selectors = new Set<string>(); const identities = new Set<string>();
  for (const engine of engines) {
    const { profile, validation } = engine;
    requireValid(profile.installationId === first.profile.installationId && profile.stagingRoot === first.profile.stagingRoot
      && profile.user === first.profile.user);
    const key = selector({ id: engine.manifest.engineId, imageDigest: engine.manifest.imageDigest, configVersion: engine.configVersion });
    const id = JSON.stringify([validation.manifestId, validation.profileId, validation.catalogVersion]);
    requireValid(!selectors.has(key) && !identities.has(id)); selectors.add(key); identities.add(id);
  }
}
export function installedRegistrations(input: readonly EngineRegistration[]): readonly InstalledEngine[] {
  try {
    requireValid(Array.isArray(input) && input.length > 0 && input.length <= MAX_ENGINE_PROFILES);
    const engines = Array.from({ length: input.length }, (_, index) => registration(field(input, String(index))));
    consistent(engines); return Object.freeze(engines);
  } catch { throw new CatalogError('invalid_registration'); }
}
