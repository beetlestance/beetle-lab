import type { Budget, InstallationSettings, SettingsScope } from '@beetle/contracts/api';
import type { SettingsData } from './intents.js';
import { ids } from '../../app/test-fixtures.js';
export const budget: Budget = { cpuMillis: 1000, memoryBytes: 1024, pids: 10, timeoutMs: 100, outputBytes: 2048 };
export function settings(scope: SettingsScope = { kind: 'installation' }, version = 1): SettingsData {
  const source = { kind: 'installation' as const };
  const effective: InstallationSettings['effective'] = {
    runDefaults: { engineProfile: { value: 'k6', source, allowedValues: ['k6', 'k6-small'] },
      budget: { cpuMillis: { value: 1000, source, allowedRange: { minimum: 1, maximum: 2000 } },
        memoryBytes: { value: 1024, source, allowedRange: { minimum: 1, maximum: 4096 } },
        pids: { value: 10, source, allowedRange: { minimum: 1, maximum: 100 } },
        timeoutMs: { value: 100, source, allowedRange: { minimum: 1, maximum: 1000 } },
        outputBytes: { value: 2048, source, allowedRange: { minimum: 1, maximum: 4096 } } } },
    retention: { value: { mode: 'manual' }, source },
  };
  const base = { id: ids.request, version, schemaVersion: 2 as const, effective };
  return scope.kind === 'installation' ? { ...base, scope, values: { pool: { cpuMillis: 2000, memoryBytes: 4096, pids: 100, outputBytes: 4096, concurrency: 2, storageBytes: 10000, freeSpaceReserveBytes: 0 }, perRunCeilings: budget,
    runDefaults: { engineProfile: 'k6', budget }, retention: { mode: 'manual' }, supportedProfiles: ['k6', 'k6-small'] } }
    : scope.kind === 'organization' ? { ...base, scope, overrides: {} } : { ...base, scope, overrides: {} };
}
export const orgScope = { kind: 'organization' as const, organizationId: ids.a };
export const workspaceScope = { kind: 'workspace' as const, organizationId: ids.a, workspaceId: ids.workspace };
