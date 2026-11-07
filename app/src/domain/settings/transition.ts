import type { SettingsScope } from '@beetle/contracts/api';
import { immutableSnapshot, nextVersion, requireRule, sameScope, sameUuid } from '../namespaces/index.js';
import { patchInstallationValues, patchScopedOverrides } from './patch.js';
import { poolLowered } from './validation.js';
import { resolveEffectiveSettings } from './resolve.js';
import type { SettingsChain, SettingsRecord } from './resolve.js';
import type { SettingsChange, SettingsCommand, SettingsEvidence, SettingsRequest } from './types.js';

function scopedRecord(scope: SettingsScope, chain: SettingsChain): SettingsRecord {
  if (scope.kind === 'installation') return chain.installation;
  const record = scope.kind === 'organization' ? chain.organization : chain.workspace;
  requireRule(record !== undefined && sameScope(record.scope, scope), 'not_found');
  return record;
}

function updatedChain(command: SettingsCommand, chain: SettingsChain): {
  chain: SettingsChain; current: SettingsRecord; next: SettingsRecord;
} {
  const { request } = command;
  const current = scopedRecord(request.scope, chain);
  requireRule(sameUuid(current.id, command.id), 'not_found');
  requireRule(current.version === request.expectedVersion, 'conflict');
  const version = nextVersion(current.version);
  if (request.scope.kind === 'installation') {
    requireRule('values' in current && 'pool' in chain.installation.values);
    // Union narrowing by patch scope is explicit; no fields are copied from effective.
    const patch = request.patch as Extract<SettingsRequest, { scope: { kind: 'installation' } }>['patch'];
    const next = { ...current, version, values: patchInstallationValues(current.values, patch) };
    return { current, next, chain: { installation: next } };
  }
  requireRule('overrides' in current);
  const patch = request.patch as Extract<SettingsRequest, { scope: { kind: 'organization' | 'workspace' } }>['patch'];
  const next = { ...current, version, overrides: patchScopedOverrides(current.overrides, patch) };
  if (next.scope.kind === 'organization') {
    return { current, next, chain: { installation: chain.installation,
      organization: { ...next, scope: next.scope } } };
  }
  requireRule(next.scope.kind === 'workspace');
  return { current, next, chain: { ...chain, workspace: { ...next, scope: next.scope } } };
}

export function decideSettingsChange(command: SettingsCommand, evidence: SettingsEvidence): SettingsChange {
  const { chain, current, next } = updatedChain(command, evidence.chain);
  const effective = resolveEffectiveSettings({ scope: command.request.scope, chain, runtime: evidence.runtime });
  const admission = 'values' in current && 'values' in next && poolLowered(current.values.pool, next.values.pool)
    ? 'drain' : 'unchanged';
  const settings = { ...next, effective };
  return immutableSnapshot({ settings, admission });
}
