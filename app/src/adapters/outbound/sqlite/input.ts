import { captureNamespaceDeletionOperation } from './namespace-deletion/index.js';
import { retentionOperation,captureRetentionOperation,retentionReplyLimit } from './retention-wire/index.js';
import { settlementOperation,captureSettlementOperation } from './backend-settlement/index.js';
import { historyOperation, captureHistoryOperation } from './run-history/index.js';
import {exportOperation,captureExportOperation,exportReplyLimit,exportRequestLimit} from './export-wire.js';
import { localSessionOperation, captureLocalSessionOperation } from './local-session/index.js';
import { deletionOperation, captureDeletionOperation, deletionReplyLimit } from './output-deletion/index.js';
import { executionOperation, captureExecutionOperation } from './execution-binding/index.js';
import { artifactReadOperation, captureArtifactReadOperation } from './run-artifacts/index.js';
import { runEventsOperation, captureRunEventsOperation } from './run-events/index.js';
import { absenceOperation, captureAbsenceOperation } from './output-absence/index.js';
import { finalizationOperation, captureFinalizationOperation } from './output-finalization/index.js';
import { resultOperation, captureResultOperation } from './run-results/index.js';
import { artifactOperation } from './output-artifacts/index.js';
import { outputOperation, captureOutputOperation, outputReplyLimit } from './output-custody/index.js';
import { eventOperation, captureEventOperation, eventRequestLimit, eventReplyLimit } from './event-custody/index.js';
import { checkedRunOperation } from './run-validation.js';
import { captureDispatchOperation, dispatchOperation, dispatchRequestLimit, dispatchReplyLimit } from './dispatch-wire.js';
import { checkedExportConfiguration, checkedRunConfiguration } from '../execution-profiles/index.js';
import { checkedInputOperation } from './input-validation.js';
import { MAX_MESSAGE_BYTES, boundedCopy, checkedScope, uuid, sha256, checkedJournalAuthority } from './input-values.js';
export { MAX_MESSAGE_BYTES, boundedCopy, checkedScope, uuid, sha256, lower, scopeKey } from './input-values.js';
import { prepareSuiteCommand } from '../../../application/suites/index.js';
import { validateApi } from '@beetle/contracts/api';
import { prepareNamespaceCommand } from '../../../application/namespaces/index.js';
import { prepareSettingsCommand } from '../../../application/settings/index.js';
import { requireRule } from '../../../domain/namespaces/index.js';
import { StorageError } from './protocol.js';
import type { Bootstrap, EntityKey, ListQuery, Operation, RuntimeObservation } from './protocol.js';

function checkedObservationTime(observation: RuntimeObservation, ttl: number): void {
  const now = Date.now();
  requireRule(observation !== undefined && Number.isSafeInteger(observation.observedAtMs) &&
    observation.observedAtMs >= 0 && observation.observedAtMs <= now && now - observation.observedAtMs < ttl);
  requireRule(Number.isSafeInteger(now) && now >= 0 && now <= 8640000000000000);
  requireRule(Number.isSafeInteger(observation.expiresAtMs) && observation.expiresAtMs > now &&
    observation.expiresAtMs <= 8640000000000000);
}
function checkedExecution(execution: RuntimeObservation['execution']): void {
  requireRule(execution !== null && typeof execution === 'object' &&
    Object.keys(execution).length === 2 && Object.hasOwn(execution, 'stagingBytes') &&
    Object.hasOwn(execution, 'perRunStagingBytes'));
  const maximum = Math.floor(Number.MAX_SAFE_INTEGER / 256);
  requireRule(Number.isSafeInteger(execution.stagingBytes) && execution.stagingBytes > 0 &&
    execution.stagingBytes <= maximum && Number.isSafeInteger(execution.perRunStagingBytes) &&
    execution.perRunStagingBytes > 0 && execution.perRunStagingBytes <= execution.stagingBytes);
}
export function checkedRuntime(observation: RuntimeObservation | null, ttl = 5000): void {
  if (observation === null) return;
  checkedJournalAuthority(observation.journalAuthority);
  checkedObservationTime(observation, ttl);
  checkedExecution(observation.execution);
  const runtime = observation.ceilings;
  requireRule(runtime !== undefined && validateApi('PoolCapacity', runtime.pool).ok && validateApi('Budget', runtime.perRun).ok);
  requireRule(Array.isArray(runtime.supportedProfiles) && runtime.supportedProfiles.length >= 1 &&
    runtime.supportedProfiles.length <= 32 && new Set(runtime.supportedProfiles).size === runtime.supportedProfiles.length);
  runtime.supportedProfiles.forEach(profile => requireRule(validateApi('EngineProfile', profile).ok));
}
export function checkedBootstrap(input: Bootstrap): Bootstrap {
  const copy = boundedCopy(input);
  const record = copy.installation;
  uuid(record.id); requireRule(record.version === 1 && record.schemaVersion === 2);
  requireRule(validateApi('InstallationScope', record.scope).ok && validateApi('InstallationValues', record.values).ok);
  const ttl = copy.runtimeTtlMs ?? 5000;
  requireRule(Number.isSafeInteger(ttl) && ttl >= 1 && ttl <= 60000);
  checkedRuntime(copy.runtime, ttl);
  copy.runs = checkedRunConfiguration(copy.runs ?? { profiles: [], pendingLimit: 256 });
  copy.exports = checkedExportConfiguration(copy.exports ?? {profiles:[],pendingLimit:copy.runs.pendingLimit},copy.runs);
  return boundedCopy(copy);
}
function checkedKey(key: EntityKey): void {
  checkedScope(key.scope); uuid(key.id);
  const expected = { organization: 'installation', workspace: 'organization', folder: 'workspace' };
  requireRule(expected[key.kind] === key.scope.kind);
}
function checkedList(query: ListQuery): void {
  checkedKey({ ...query, id: '00000000-0000-4000-8000-000000000000' });
  requireRule(Number.isSafeInteger(query.limit) && query.limit >= 1 && query.limit <= 100);
  if (query.kind === 'folder') { if (query.parentFolderId !== undefined) uuid(query.parentFolderId); }
  else requireRule(query.parentFolderId === undefined);
  if (query.cursor !== undefined) requireRule(typeof query.cursor === 'string' && query.cursor.length <= 1024);
}
function checkedNamespace(operation: Extract<Operation, { kind: 'namespace' }>): void {
  const command = operation.command;
  const names = { createOrganization: 'CreateOrganizationRequest', patchOrganization: 'PatchOrganizationRequest',
    createWorkspace: 'CreateWorkspaceRequest', patchWorkspace: 'PatchWorkspaceRequest',
    createFolder: 'CreateFolderRequest', patchFolder: 'PatchFolderRequest' } as const;
  requireRule(Object.hasOwn(names, command.kind) && validateApi(names[command.kind], command.request).ok);
  uuid(command.id); if (command.kind === 'createWorkspace') uuid(command.rootFolderId);
  requireRule(prepareNamespaceCommand(command, sha256).intentDigest === command.intentDigest);
}
function checkedSettings(operation: Extract<Operation, { kind: 'settings' }>): void {
  const command = operation.command;
  uuid(command.id); requireRule(command.kind === 'patchSettings'); checkedScope(command.request.scope);
  const names = { installation: 'PatchInstallationSettingsRequest', organization: 'PatchOrganizationSettingsRequest',
    workspace: 'PatchWorkspaceSettingsRequest' } as const;
  requireRule(validateApi(names[command.request.scope.kind], command.request).ok);
  requireRule(prepareSettingsCommand({ ...command, digest: sha256 }).intentDigest === command.intentDigest);
}
function checkedSuiteList(operation: Extract<Operation, { kind: 'listSuites' | 'listRevisions' }>): void {
  const query = operation.query;
  requireRule(validateApi('WorkspaceScope', query.scope).ok);
  requireRule(Number.isSafeInteger(query.limit) && query.limit >= 1 && query.limit <= 100);
  if (query.cursor !== undefined) requireRule(typeof query.cursor === 'string' && query.cursor.length <= 1024);
  if (operation.kind === 'listRevisions') uuid(operation.query.suiteId);
}
function checkedSuiteOperation(operation: Operation): void {
  switch (operation.kind) {
    case 'suite': {
      uuid(operation.command.id);
      if (operation.command.kind === 'createSuiteRevision') uuid(operation.command.suiteId);
      requireRule(prepareSuiteCommand(operation.command, sha256).intentDigest === operation.command.intentDigest);
      break;
    }
    case 'getSuite': case 'getRevision':
      requireRule(validateApi('WorkspaceScope', operation.key.scope).ok); uuid(operation.key.id); break;
    case 'listSuites': case 'listRevisions': checkedSuiteList(operation); break;
    default: throw new StorageError('invalid_input');
  }
}
function settingsRead(operation: Operation): boolean {
  if (operation.kind !== 'getSettings' && operation.kind !== 'getSettingsIdentity') return false;
  checkedScope(operation.scope); return true;
}
function checkedExtendedOperation(operation: Operation): boolean {
  if (historyOperation(operation)) { captureHistoryOperation(operation); return true; }
  if (checkedRunOperation(operation)) return true;
  if (checkedInputOperation(operation)) return true;
  if (suiteOperation(operation)) { checkedSuiteOperation(operation); return true; }
  return settingsRead(operation);
}
export function checkedOperation(input: Operation, runtimeTtlMs = 5000): Operation {
  try {
    if(retentionOperation(input))return captureRetentionOperation(input);
    if (exportOperation(input)) return captureExportOperation(input);
    if (localSessionOperation(input)) return captureLocalSessionOperation(input);
    if (deletionOperation(input)) return captureDeletionOperation(input);
    if (executionOperation(input)) return captureExecutionOperation(input);
    if (artifactReadOperation(input)) return captureArtifactReadOperation(input);
    if (runEventsOperation(input)) return captureRunEventsOperation(input);
  } catch {throw new StorageError('invalid_input');}
  return checkedDeferredOperation(input,runtimeTtlMs);
}
function checkedDeferredOperation(input:Operation,runtimeTtlMs:number):Operation {
  if(input.kind === 'deleteNamespace')return captureNamespaceDeletionOperation(input);
  if(settlementOperation(input)){try{return captureSettlementOperation(input);}catch{throw new StorageError('invalid_input');}}
  if(absenceOperation(input))return checkedAbsenceOperation(input);
  return checkedOutputOperation(input,runtimeTtlMs);
}
function checkedAbsenceOperation(input: Operation): Operation {
  try { return captureAbsenceOperation(input); } catch { throw new StorageError('invalid_input'); }
}
function checkedOutputOperation(input: Operation, runtimeTtlMs: number): Operation {
  if (finalizationOperation(input)) {
    try { return captureFinalizationOperation(input); } catch { throw new StorageError('invalid_input'); }
  }
  if (resultOperation(input)) {
    try { return captureResultOperation(input); } catch { throw new StorageError('invalid_input'); }
  }
  if (outputOperation(input)) {
    try { return captureOutputOperation(input); } catch { throw new StorageError('invalid_input'); }
  }
  if (eventOperation(input)) {
    try { return captureEventOperation(input); } catch { throw new StorageError('invalid_input'); }
  }
  return checkedCommonOperation(input, runtimeTtlMs);
}
function checkedCommonOperation(input: Operation, runtimeTtlMs: number): Operation {
  const operation = boundedCopy(input, operationMessageLimit(input));
  if (dispatchOperation(operation)) return captureDispatchOperation(operation);
  if (checkedExtendedOperation(operation)) return operation;
  switch (operation.kind) {
    case 'namespace': checkedNamespace(operation); break;
    case 'settings': checkedSettings(operation); break;
    case 'get': checkedKey(operation.key); break;
    case 'list': checkedList(operation.query); break;

    case 'runtime': checkedRuntime(operation.runtime, runtimeTtlMs); break;
    case 'close': break;
    default: throw new StorageError('invalid_input');
  }
  return operation;
}

export function suiteOperation(operation: Operation): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(operation, 'kind');
  return !!descriptor && 'value' in descriptor && ['suite', 'getSuite', 'getRevision', 'listSuites', 'listRevisions'].includes(descriptor.value as string);
}

/** Inspect data descriptors only: boundedCopy rejects accessors without invoking them. */
function dataProperty(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}
const fixedMessageLimits:Partial<Record<Operation['kind'],number>>={loadLocalSession:2048,saveLocalSession:2048,settleBackendOutput:2304,readBackendSettlement:2304};
export function operationMessageLimit(operation: Operation): number {
  if(operation.kind === 'deleteNamespace')return 4096;
  if(retentionOperation(operation))return 12288;
  if (exportOperation(operation)) return exportRequestLimit(operation);
  const fixed=fixedMessageLimits[dataProperty(operation,'kind') as Operation['kind']];if(fixed!==undefined)return fixed;
  if (deletionOperation(operation)) return 12288;
  if (compactOperation(operation)) return 4096;
  if (outputOperation(operation)) return 79872;
  if (eventOperation(operation)) return eventRequestLimit(operation);
  if (dispatchOperation(operation)) return dispatchRequestLimit(operation);
  return authoringMessageLimit(operation);
}
function authoringMessageLimit(operation:Operation):number{
  if (dataProperty(operation, 'kind') !== 'suite') return MAX_MESSAGE_BYTES;
  const command = dataProperty(operation, 'command');
  return dataProperty(command, 'kind') === 'createSuiteRevision' ? 2097152 : MAX_MESSAGE_BYTES;
}

/** One two-original allowance is shared by suites, Offers and event batches. */
export function largeOperation(operation: Operation): boolean {
  if(retentionOperation(operation))return true;
  if(dataProperty(operation,'kind')==='exportOutput'){
    const method=dataProperty(dataProperty(operation,'operation'),'method');return method==='adopt'||method==='source';
  }
  return suiteOperation(operation) || ['getExportOriginal','listExports','dispatchReadOffer', 'eventIngest', 'outputAdopt', 'outputReadSource', 'getRunResult', 'getRunEvents', 'listRunArtifacts'].includes(dataProperty(operation, 'kind') as string);
}
const fixedReplyLimits: Partial<Record<Operation['kind'], number>> = { deleteNamespace:2048, historySummary: 16384, getWorkspaceOverview: 32768, settleBackendOutput:1536,readBackendSettlement:1536 };
export function operationReplyLimit(operation: Operation): number {
  if(retentionOperation(operation))return retentionReplyLimit(operation);
  const fixed = fixedReplyLimits[operation.kind];
  if (fixed !== undefined) return fixed;
  if (exportOperation(operation)) return exportReplyLimit(operation);
  if (localSessionOperation(operation)) return 2048;
  if (deletionOperation(operation)) return deletionReplyLimit(operation);
  if (absenceOperation(operation) || finalizationOperation(operation)) return 4096;
  return readReplyLimit(operation);
}
function readReplyLimit(operation:Operation):number{
  if (operation.kind === 'getRunArtifact') return 4096;
  if (runEventsOperation(operation)) return 262144;
  if (['listRunArtifacts', 'getRunResult'].includes(operation.kind)) return 73728;
  return payloadReplyLimit(operation);
}
/** Variable payload owners retain their own reply budget; fixed envelopes are above. */
function payloadReplyLimit(operation: Operation): number {
  if (outputOperation(operation)) return outputReplyLimit(operation);
  if (eventOperation(operation)) return eventReplyLimit(operation);
  if (dispatchOperation(operation)) return dispatchReplyLimit(operation);
  return operation.kind === 'getRevision' ? 2_097_152 : Math.max(1_048_576, operationMessageLimit(operation));
}

/** Fixed small control/read requests never use large payload envelopes. */
function compactOperation(operation: Operation): boolean {
  return ['getWorkspaceOverview', 'historySummary'].includes(dataProperty(operation,'kind') as string)||artifactReadOperation(operation) || runEventsOperation(operation) || absenceOperation(operation) || finalizationOperation(operation)
    || executionOperation(operation) || resultOperation(operation) || artifactOperation(operation);
}
