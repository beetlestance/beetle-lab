import type { AbsenceOperation } from './output-absence/index.js';
import type { OutputAbsenceState, OutputAbsenceFinalizationReply } from '../../../ports/output-absence.js';
import type { OutputFinalizationRequest, OutputFinalizationReply } from '../../../ports/output-finalization.js';
import type { OutputArtifactClaim, OutputArtifactProgress } from '../../../ports/output-artifacts.js';
import type { OutputFileRecord } from '../../../ports/output-bytes.js';
import type { Owned, SourceEnvelope } from '@beetle/contracts/output-source';
import type { OutputAdoptRequest, OutputCustodyState, OutputPage } from '../../../ports/output-custody.js';
import type { EventBinding, EventScan, EventPage, EventCursorState, EventIngestRequest, EventIngestResult, EventAckRequest, EventProblemRequest } from '../../../ports/events.js';
import type { RunConfiguration, RunCommand, CancelRunCommand, RunKey, RunList } from '../../../ports/runs.js';
import type { DispatchKey, DispatchScan, DispatchObservationRequest, DispatchPage,
  DispatchOffer, DispatchClaim, DispatchObservation } from '../../../ports/dispatch.js';
import type { Run, RunPage, RunResultSnapshot } from '@beetle/contracts/api';
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

export const STORAGE_ERROR_CODES = Object.freeze(['invalid_input', 'invalid_value', 'not_found', 'conflict',
  'capacity_unavailable', 'queue_full', 'closed', 'unavailable', 'owned', 'schema_newer'] as const);
export type ErrorCode = typeof STORAGE_ERROR_CODES[number];
export class StorageError extends Error {
  constructor(readonly code: ErrorCode) { super(`Storage ${code}`); this.name = 'StorageError'; }
}
import type { RuntimeObservation } from '../../../ports/runtime.js';
export type { RuntimeObservation } from '../../../ports/runtime.js';
export type SettingsView = InstallationSettings | OrganizationSettings | WorkspaceSettings;
export type Operation = AbsenceOperation

  | { kind: 'outputFinalize'; request: OutputFinalizationRequest }
  | { kind: 'outputClaimArtifact' | 'outputBeginPublication'; request: OutputArtifactClaim }
  | { kind: 'outputRecordProgress' | 'outputRecordPublication'; request: OutputArtifactProgress }
  | { kind: 'outputScan'; query: EventScan }
  | { kind: 'outputLoad'; binding: EventBinding }
  | { kind: 'outputReadSource'; binding: EventBinding }
  | { kind: 'outputAdopt'; request: OutputAdoptRequest }
  | { kind: 'eventScan'; query: EventScan }
  | { kind: 'eventLoad'; binding: EventBinding }
  | { kind: 'eventIngest'; request: EventIngestRequest }
  | { kind: 'eventConfirmAck'; request: EventAckRequest }
  | { kind: 'eventProblem'; request: EventProblemRequest }
  | { kind: 'dispatchScan'; query: DispatchScan }
  | { kind: 'dispatchReadOffer'; key: DispatchKey }
  | { kind: 'dispatchClaim'; key: DispatchKey }
  | { kind: 'dispatchObserve'; request: DispatchObservationRequest }
  | { kind: 'run'; command: RunCommand }
  | { kind: 'cancelRun'; command: CancelRunCommand }
  | { kind: 'getRun'; key: RunKey }
  | { kind: 'getRunResult'; key: RunKey }
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
export type Value = OutputAbsenceState | OutputAbsenceFinalizationReply | OutputFinalizationReply | OutputFileRecord | OutputCustodyState | OutputPage | Owned<SourceEnvelope> | EventPage | EventCursorState | EventIngestResult | DispatchPage | DispatchOffer | DispatchClaim | DispatchObservation | Run | RunPage | RunResultSnapshot | InputRecord | InputReceipt | InputPage | InputStorage | Suite | SuiteRevision | SuitePage | SuiteRevisionPage | Organization | Workspace | Folder | SettingsChange | SettingsView | SettingsIdentity | EntityPage | null;
export type Command = Operation & { messageId: number };
export type Reply = { kind: 'ready' } | { kind: 'startup_error'; code: ErrorCode } |
  { kind: 'result'; messageId: number; ok: true; value: Value } |
  { kind: 'result'; messageId: number; ok: false; code: ErrorCode };
export interface Bootstrap { installation: InstallationRecord; runtime: RuntimeObservation | null; runtimeTtlMs?: number; runs?: RunConfiguration }
