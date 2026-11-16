import { encodeJson, validatePrimitive } from '@beetle/contracts';
import { validateApi } from '@beetle/contracts/api';
import type { SettingsScope, InstallationSettings, OrganizationSettings, WorkspaceSettings } from '@beetle/contracts/api';
import { immutableSnapshot, requireRule, sameScope, sameUuid } from '../../domain/namespaces/index.js';
import type { SettingsIdentity, SettingsReader, SettingsView } from '../../ports/settings-reader.js';
import type { SettingsRequest, SettingsStore } from '../../ports/settings.js';
import type { IntentDigest } from '../namespaces/index.js';
import { patchSettings } from './mutate.js';

type Views = { installation: InstallationSettings; organization: OrganizationSettings; workspace: WorkspaceSettings };
const schemas = { installation: 'InstallationSettings', organization: 'OrganizationSettings', workspace: 'WorkspaceSettings' } as const;
const requests = { installation: 'PatchInstallationSettingsRequest', organization: 'PatchOrganizationSettingsRequest',
  workspace: 'PatchWorkspaceSettingsRequest' } as const;

function snapshot<T>(value: T, maximum: number): T {
  try { return immutableSnapshot(JSON.parse(encodeJson(value, maximum)) as T); }
  catch { throw new Error('Invalid settings boundary value'); }
}
function authority(scope: SettingsScope): SettingsScope {
  const copy = snapshot(scope, 2048);
  if (!validateApi('SettingsScope', copy).ok) throw new Error('Invalid settings scope');
  return copy;
}
function ancestor(source: SettingsScope, scope: SettingsScope): boolean {
  if (source.kind === 'installation') return true;
  if (scope.kind === 'installation' || !sameUuid(source.organizationId, scope.organizationId)) return false;
  return source.kind === 'organization' || sameScope(source, scope);
}
function checkedView(scope: SettingsScope, input: unknown): SettingsView {
  const copy = snapshot(input, 65536);
  const result = validateApi(schemas[scope.kind], copy);
  if (!result.ok) throw new Error('Invalid settings repository response');
  const value = result.value;
  requireRule(sameScope(value.scope, scope), 'not_found');
  const defaults = value.effective.runDefaults;
  const sources = [defaults.engineProfile.source, value.effective.retention.source,
    ...Object.values(defaults.budget).map(item => item.source)];
  requireRule(sources.every(source => ancestor(source, scope)), 'not_found');
  return immutableSnapshot(value);
}

export async function getSettings<S extends SettingsScope>(scope: S, reader: SettingsReader): Promise<Views[S['kind']]> {
  const expected = authority(scope);
  return checkedView(expected, await reader.getSettings(authority(expected))) as Views[S['kind']];
}

export async function getSettingsIdentity(scope: SettingsScope, reader: SettingsReader): Promise<SettingsIdentity> {
  const expected = authority(scope);
  const copy = snapshot(await reader.getSettingsIdentity(authority(expected)), 2048);
  if (copy === null || typeof copy !== 'object' || Array.isArray(copy) ||
    Object.keys(copy).length !== 2 || !Object.hasOwn(copy, 'id') || !Object.hasOwn(copy, 'scope') ||
    !validatePrimitive('uuid', copy.id).ok || !validateApi('SettingsScope', copy.scope).ok) {
    throw new Error('Invalid settings identity response');
  }
  requireRule(sameScope(copy.scope, expected), 'not_found');
  return copy;
}

/** Retain the complete mutation authority before identity I/O; never pre-read effective settings. */
export async function patchScopedSettings<S extends SettingsScope>(input: {
  scope: S; request: SettingsRequest; reader: SettingsReader; store: SettingsStore; digest: IntentDigest;
}): Promise<Views[S['kind']]> {
  const expected = authority(input.scope);
  const request = snapshot(input.request, 65536);
  if (!validateApi(requests[expected.kind], request).ok) throw new Error('Invalid settings request');
  requireRule(sameScope(expected, request.scope), 'not_found');
  const { store, digest, reader } = input;
  const identity = await getSettingsIdentity(authority(expected), reader);
  const boundedStore: SettingsStore = { execute: async command => snapshot(await store.execute(command), 65536) };
  const change = await patchSettings({ id: identity.id, request, store: boundedStore, digest });
  return checkedView(expected, change.settings) as Views[S['kind']];
}
