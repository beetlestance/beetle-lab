import type { Budget, Folder, Organization, Workspace, WorkspaceScope } from '@beetle/contracts/api';
import type { RuntimeCeilings, SettingsChain } from '../../src/domain/settings/index.js';

export const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const digest = (text: string): string => {
  // Deliberately synthetic deterministic test digest, not production cryptography.
  let hash = 0;
  for (const character of text) hash = ((hash * 31) + character.charCodeAt(0)) >>> 0;
  return hash.toString(16).padStart(64, '0');
};
export const budget: Budget = { cpuMillis: 100, memoryBytes: 100, pids: 10, timeoutMs: 100, outputBytes: 100 };
export const scope: WorkspaceScope = { kind: 'workspace', organizationId: uuid(1), workspaceId: uuid(2) };
export const organization: Organization = { id: uuid(1), version: 1, scope: { kind: 'installation' }, name: 'Team', slug: 'team' };
export const workspace: Workspace = { id: uuid(2), version: 1,
  scope: { kind: 'organization', organizationId: uuid(1) }, name: 'Project', rootFolderId: uuid(3) };
export const root: Folder = { id: uuid(3), version: 1, scope, name: 'Project', parentFolderId: null, displayPath: ['Project'] };
export function folder(n: number, parent = root.id): Folder {
  return { id: uuid(n), version: 1, scope, name: `Folder ${n}`, parentFolderId: parent,
    displayPath: ['Project', `Folder ${n}`] };
}
export function settingsFixture(): { chain: SettingsChain; runtime: RuntimeCeilings } {
  const pool = { cpuMillis: 2000, memoryBytes: 2000, pids: 200, outputBytes: 2000,
    concurrency: 2, storageBytes: 10000, freeSpaceReserveBytes: 1000 };
  return {
    chain: {
      installation: { id: uuid(10), version: 1, schemaVersion: 2, scope: { kind: 'installation' },
        values: { pool, perRunCeilings: { cpuMillis: 1000, memoryBytes: 1000,
          pids: 100, timeoutMs: 1000, outputBytes: 1000 }, supportedProfiles: ['standard', 'isolated'],
        runDefaults: { engineProfile: 'standard', budget: { ...budget } }, retention: { mode: 'manual' } } },
      organization: { id: uuid(11), version: 1, schemaVersion: 2,
        scope: { kind: 'organization', organizationId: scope.organizationId }, overrides: {} },
      workspace: { id: uuid(12), version: 1, schemaVersion: 2, scope: { ...scope }, overrides: {} },
    },
    runtime: { pool: { ...pool, cpuMillis: 4000, storageBytes: 20000, freeSpaceReserveBytes: 2000 },
      perRun: { cpuMillis: 2000, memoryBytes: 2000, pids: 200, timeoutMs: 2000, outputBytes: 2000 },
      supportedProfiles: ['standard', 'isolated'] },
  };
}
