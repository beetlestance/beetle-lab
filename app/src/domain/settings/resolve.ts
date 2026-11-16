import type {
  Budget, EffectiveBudget, EffectiveSettings, InstallationSettings, OrganizationSettings,
  RunDefaultOverrides, RunDefaults, ScopedOverrides, SettingsScope, WorkspaceSettings, WorkspaceScope,
} from '@beetle/contracts/api';
import { immutableSnapshot, requireRule, sameScope, sameUuid } from '../namespaces/index.js';
import { budgetKeys, validateInstallation, validateRetention, validateRunDefaults } from './validation.js';
import type { RuntimeCeilings } from './validation.js';

export type InstallationRecord = Omit<InstallationSettings, 'effective'>;
export type OrganizationRecord = Omit<OrganizationSettings, 'effective'>;
export type WorkspaceRecord = Omit<WorkspaceSettings, 'effective'>;
export type SettingsRecord = InstallationRecord | OrganizationRecord | WorkspaceRecord;
export interface SettingsChain {
  installation: InstallationRecord;
  organization?: OrganizationRecord;
  workspace?: WorkspaceRecord;
}
type Layer = { scope: SettingsScope; overrides: ScopedOverrides };
type ResolutionSource = SettingsScope | 'suiteRevision' | 'run';

/** Internal semantic snapshot derived from API defaults; no new wire contract. */
export type RunResolution = Readonly<{
  defaults: RunDefaults;
  sources: { engineProfile: ResolutionSource; budget: Record<keyof Budget, ResolutionSource> };
}>;

function scopedLayers(scope: SettingsScope, chain: SettingsChain): Layer[] {
  requireRule(chain.installation.scope.kind === 'installation', 'not_found');
  const layers: Layer[] = [];
  if (scope.kind === 'installation') {
    requireRule(chain.organization === undefined && chain.workspace === undefined, 'not_found');
    return layers;
  }
  const organization = chain.organization;
  requireRule(organization !== undefined && sameUuid(organization.scope.organizationId, scope.organizationId), 'not_found');
  layers.push({ scope: organization.scope, overrides: organization.overrides });
  if (scope.kind === 'organization') {
    requireRule(chain.workspace === undefined, 'not_found');
    return layers;
  }
  const workspace = chain.workspace;
  requireRule(workspace !== undefined && sameScope(workspace.scope, scope), 'not_found');
  layers.push({ scope: workspace.scope, overrides: workspace.overrides });
  return layers;
}

function resolveDefaults(input: {
  chain: SettingsChain; layers: readonly { scope: ResolutionSource; overrides: RunDefaultOverrides }[];
  runtime: RuntimeCeilings | null;
}): RunResolution {
  const { chain, layers, runtime } = input;
  const values = chain.installation.values;
  validateInstallation(values, runtime);
  const defaults = { ...values.runDefaults, budget: { ...values.runDefaults.budget } };
  const installation = chain.installation.scope;
  const sources: RunResolution['sources'] = { engineProfile: installation,
    budget: { cpuMillis: installation, memoryBytes: installation, pids: installation,
      timeoutMs: installation, outputBytes: installation } };
  layers.forEach(({ scope, overrides }) => {
    if (overrides.engineProfile !== undefined) {
      defaults.engineProfile = overrides.engineProfile;
      sources.engineProfile = scope;
    }
    budgetKeys.forEach(key => {
      const value = overrides.budget?.[key];
      if (value !== undefined) { defaults.budget[key] = value; sources.budget[key] = scope; }
    });
    // Invalid ancestor policy must not be hidden by a valid descendant override.
    validateRunDefaults(defaults, values);
  });
  return immutableSnapshot({ defaults, sources });
}

function resolveRetention(chain: SettingsChain, layers: readonly Layer[]): EffectiveSettings['retention'] {
  let retention = { value: chain.installation.values.retention,
    source: chain.installation.scope as SettingsScope };
  validateRetention(retention.value);
  layers.forEach(layer => {
    if (layer.overrides.retention !== undefined) {
      validateRetention(layer.overrides.retention);
      retention = { value: layer.overrides.retention, source: layer.scope };
    }
  });
  return retention;
}

export function resolveEffectiveSettings(input: {
  scope: SettingsScope; chain: SettingsChain; runtime: RuntimeCeilings | null;
}): EffectiveSettings {
  const layers = scopedLayers(input.scope, input.chain);
  const resolved = resolveDefaults({ ...input, layers: layers.map(layer =>
    ({ scope: layer.scope, overrides: layer.overrides.runDefaults ?? {} })) });
  const values = input.chain.installation.values;
  const budget = {} as EffectiveBudget;
  budgetKeys.forEach(key => {
    const source = resolved.sources.budget[key];
    requireRule(typeof source !== 'string');
    budget[key] = { value: resolved.defaults.budget[key], source,
      allowedRange: { minimum: 1, maximum: values.perRunCeilings[key] } };
  });
  const retention = resolveRetention(input.chain, layers);
  const profileSource = resolved.sources.engineProfile;
  requireRule(typeof profileSource !== 'string');
  return immutableSnapshot({ runDefaults: { engineProfile: { value: resolved.defaults.engineProfile,
    source: profileSource, allowedValues: values.supportedProfiles }, budget }, retention });
}

export function resolveRunSettings(input: {
  scope: WorkspaceScope; chain: SettingsChain; runtime: RuntimeCeilings | null;
  suiteRevision?: RunDefaultOverrides; run?: RunDefaultOverrides;
}): RunResolution {
  const scoped = scopedLayers(input.scope, input.chain);
  const layers: { scope: ResolutionSource; overrides: RunDefaultOverrides }[] =
    scoped.map(layer =>
      ({ scope: layer.scope, overrides: layer.overrides.runDefaults ?? {} }));
  // Validate scoped retention policies, but never apply retention at run levels.
  resolveRetention(input.chain, scoped);
  if (input.suiteRevision !== undefined) layers.push({ scope: 'suiteRevision', overrides: input.suiteRevision });
  if (input.run !== undefined) layers.push({ scope: 'run', overrides: input.run });
  return resolveDefaults({ ...input, layers });
}
