import type { SettingsScope, Organization, Workspace, Folder, InstallationSettings,
  OrganizationSettings, WorkspaceSettings } from '@beetle/contracts/api';
import type { NamespaceCommand, NamespaceEntity } from '../../../ports/namespaces.js';
import type { SettingsCommand, SettingsChange } from '../../../ports/settings.js';
import type { InstallationRecord, RuntimeCeilings } from '../../../domain/settings/index.js';

export type ErrorCode = 'invalid_input' | 'invalid_value' | 'not_found' | 'conflict' |
  'capacity_unavailable' | 'queue_full' | 'closed' | 'unavailable' | 'owned' | 'schema_newer';
export class StorageError extends Error {
  constructor(readonly code: ErrorCode) { super(`Storage ${code}`); this.name = 'StorageError'; }
}
export type EntityKind = 'organization' | 'workspace' | 'folder';
export interface EntityKey { kind: EntityKind; scope: SettingsScope; id: string }
export interface ListQuery { kind: EntityKind; scope: SettingsScope; parentFolderId?: string;
  limit: number; cursor?: string }
export interface EntityPage { items: NamespaceEntity[]; nextCursor: string | null }
export interface RuntimeObservation { ceilings: RuntimeCeilings; observedAtMs: number }
export type SettingsView = InstallationSettings | OrganizationSettings | WorkspaceSettings;
export type Operation =
  | { kind: 'namespace'; command: NamespaceCommand }
  | { kind: 'settings'; command: SettingsCommand }
  | { kind: 'get'; key: EntityKey }
  | { kind: 'list'; query: ListQuery }
  | { kind: 'getSettings'; scope: SettingsScope }
  | { kind: 'runtime'; runtime: RuntimeObservation | null }
  | { kind: 'close' };
export type Value = Organization | Workspace | Folder | SettingsChange | SettingsView | EntityPage | null;
export type Command = Operation & { messageId: number };
export type Reply = { kind: 'ready' } | { kind: 'startup_error'; code: ErrorCode } |
  { kind: 'result'; messageId: number; ok: true; value: Value } |
  { kind: 'result'; messageId: number; ok: false; code: ErrorCode };
export interface Bootstrap { installation: InstallationRecord; runtime: RuntimeObservation | null; runtimeTtlMs?: number }
