import type { RunConfiguration, RunCommand, RunKey, RunList } from '../../../ports/runs.js';
import type { Run, RunPage } from '@beetle/contracts/api';
import type { InputCommand, InputAdvance, InputKey, InputList, InputRecoveryPage, InputRecord, InputReceipt, InputPage, InputStorage } from '../../../ports/inputs.js';
import type { Suite, SuiteRevision, SuitePage, SuiteRevisionPage } from '@beetle/contracts/api';
import type { SuiteCommand, SuiteKey, SuiteList, RevisionList } from '../../../ports/suites.js';
import type { SettingsScope, Organization, Workspace, Folder, InstallationSettings,
  OrganizationSettings, WorkspaceSettings } from '@beetle/contracts/api';
import type { NamespaceCommand } from '../../../ports/namespaces.js';
import type { EntityKey, ListQuery, EntityPage } from '../../../ports/namespace-reader.js';
export type { EntityKind, EntityKey, ListQuery, EntityPage } from '../../../ports/namespace-reader.js';
import type { SettingsCommand, SettingsChange } from '../../../ports/settings.js';
import type { SettingsIdentity } from '../../../ports/settings-reader.js';
import type { InstallationRecord } from '../../../domain/settings/index.js';

export type ErrorCode = 'invalid_input' | 'invalid_value' | 'not_found' | 'conflict' |
  'capacity_unavailable' | 'queue_full' | 'closed' | 'unavailable' | 'owned' | 'schema_newer';
export class StorageError extends Error {
  constructor(readonly code: ErrorCode) { super(`Storage ${code}`); this.name = 'StorageError'; }
}
import type { RuntimeObservation } from '../../../ports/runtime.js';
export type { RuntimeObservation } from '../../../ports/runtime.js';
export type SettingsView = InstallationSettings | OrganizationSettings | WorkspaceSettings;
export type Operation =
  | { kind: 'run'; command: RunCommand }
  | { kind: 'getRun'; key: RunKey }
  | { kind: 'listRuns'; query: RunList }
  | { kind: 'input'; command: InputCommand }
  | { kind: 'advanceInput'; command: InputAdvance }
  | { kind: 'getInput'; key: InputKey }
  | { kind: 'listInputs'; query: InputList }
  | { kind: 'recoverInputs'; query: InputRecoveryPage }
  | { kind: 'inputStorage' }
  | { kind: 'suite'; command: SuiteCommand }
  | { kind: 'getSuite'; key: SuiteKey }
  | { kind: 'getRevision'; key: SuiteKey }
  | { kind: 'listSuites'; query: SuiteList }
  | { kind: 'listRevisions'; query: RevisionList }
  | { kind: 'namespace'; command: NamespaceCommand }
  | { kind: 'settings'; command: SettingsCommand }
  | { kind: 'get'; key: EntityKey }
  | { kind: 'list'; query: ListQuery }
  | { kind: 'getSettings'; scope: SettingsScope }
  | { kind: 'getSettingsIdentity'; scope: SettingsScope }
  | { kind: 'runtime'; runtime: RuntimeObservation | null }
  | { kind: 'close' };
export type Value = Run | RunPage | InputRecord | InputReceipt | InputPage | InputStorage | Suite | SuiteRevision | SuitePage | SuiteRevisionPage | Organization | Workspace | Folder | SettingsChange | SettingsView | SettingsIdentity | EntityPage | null;
export type Command = Operation & { messageId: number };
export type Reply = { kind: 'ready' } | { kind: 'startup_error'; code: ErrorCode } |
  { kind: 'result'; messageId: number; ok: true; value: Value } |
  { kind: 'result'; messageId: number; ok: false; code: ErrorCode };
export interface Bootstrap { installation: InstallationRecord; runtime: RuntimeObservation | null; runtimeTtlMs?: number; runs?: RunConfiguration }
