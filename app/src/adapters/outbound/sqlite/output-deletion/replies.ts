import { captureCleanupAck,captureCleanupAckState } from './ack-values.js';
import { captureOutputRetirementRequest, OUTPUT_RETIREMENT_REQUEST_BYTES } from '@beetle/contracts/output-retirement';
import { encodeCanonicalJson } from '@beetle/contracts';
import { RUN_OUTPUT_METADATA_BYTES } from '../../../../ports/dispatch.js';
import { validateApi } from '@beetle/contracts/api';
import type { OutputDeletionKey, OutputDeletionOperation, OutputDeletionSummary, OutputDeletionFile, OutputDeletionValue, OutputDeletionFileKey } from '../../../../ports/output-deletion-metadata.js';
import { requireRule } from '../../../../domain/namespaces/index.js';
import { captureEventBinding } from '../../../../domain/events/index.js';
import { decodeArtifact } from '../output-custody/index.js';
import { boundedCopy } from '../input-values.js';
import { closed, hash, natural, scope, uuid } from './values.js';
import { position } from './cursor.js';
function summary(input: unknown): OutputDeletionSummary {
  closed(input, ['id','scope','requestId','runId','runVersion','deletionVersion','version','kind','stage','fileCount','preparedCount','absentCount','retainedPayloadBytes','metadataBytes','requestedAt']);
  const copy = input as unknown as OutputDeletionSummary;
  [copy.runVersion, copy.version].forEach(value => natural(value, Number.MAX_SAFE_INTEGER, 1));
  [copy.fileCount, copy.preparedCount, copy.absentCount].forEach(value => natural(value, 128)); natural(copy.retainedPayloadBytes); natural(copy.metadataBytes); requireRule(Number.isSafeInteger(copy.retainedPayloadBytes + copy.metadataBytes));
  summaryProgress(copy);
  requireRule(['source','absence','unsent'].includes(copy.kind) && validateApi('RunTimestamp', copy.requestedAt).ok);
  if (copy.kind !== 'source') requireRule(copy.fileCount === 0);
  requireRule(copy.metadataBytes === (copy.kind === 'unsent' ? 0 : RUN_OUTPUT_METADATA_BYTES)); if (copy.kind === 'unsent') requireRule(copy.retainedPayloadBytes === 0);
  return {...copy, id: uuid(copy.id), scope: scope(copy.scope), requestId: uuid(copy.requestId), runId: uuid(copy.runId)};
}
function summaryProgress(copy: OutputDeletionSummary): void {
  requireRule(copy.deletionVersion === 1 && copy.version <= 257 && copy.absentCount <= copy.preparedCount && copy.preparedCount <= copy.fileCount
    && copy.version === 1 + copy.preparedCount + copy.absentCount && copy.stage === (copy.absentCount === copy.fileCount ? 'files_absent' : 'pending'));
}
function file(input: unknown): OutputDeletionFile {
  closed(input, ['deletionId','deletionVersion','record','version','phase','namespaceIdentity','preparationIdentity']);
  const copy = input as unknown as OutputDeletionFile; closed(copy.record, ['binding','artifact']);
  const record = {binding: captureEventBinding(copy.record.binding), artifact: decodeArtifact(copy.record.artifact)};
  requireRule(record.artifact.phase === 'published' && record.artifact.writer === null && record.artifact.identity !== null && record.artifact.offset === record.artifact.bytes);
  natural(copy.version, 3, 1); requireRule(copy.deletionVersion === 1);
  if (copy.version === 1) requireRule(copy.phase === 'pending_preparation' && copy.namespaceIdentity === null && copy.preparationIdentity === null);
  else {hash(copy.namespaceIdentity); hash(copy.preparationIdentity); requireRule(copy.phase === (copy.version === 2 ? 'prepared' : 'absent'));}
  return {...copy, deletionId: uuid(copy.deletionId), record};
}
function bindFile(value: OutputDeletionFile, key: OutputDeletionFileKey): void {
  const binding = value.record.binding.key;
  requireRule(value.deletionId === key.id && value.record.artifact.ordinal === key.ordinal && binding.runId === key.runId
    && binding.attempt.organizationId === key.scope.organizationId && binding.attempt.workspaceId === key.scope.workspaceId);
}
export function deletionReplyLimit(operation: OutputDeletionOperation): number {
  if(operation.kind==='getOutputCleanupAck'||operation.kind==='recordOutputCleanupAck')return 8192;
  if (operation.kind === 'getOutputRetirementRequest') return OUTPUT_RETIREMENT_REQUEST_BYTES;
  if (operation.kind === 'scanOutputDeletions') return 65536;
  return ['beginOutputDeletion', 'getOutputDeletion', 'reserveOutputCleanupControl'].includes(operation.kind) ? 4096 : 8192;
}
export function captureDeletionReply(operation: OutputDeletionOperation, input: unknown): OutputDeletionValue {
  const copy = boundedCopy(input, deletionReplyLimit(operation));
  if(operation.kind==='getOutputCleanupAck')return captureCleanupAckState(operation.key,copy);
  if(operation.kind==='recordOutputCleanupAck')return ackWriteReply(operation.request,copy);
  if (operation.kind === 'getOutputRetirementRequest') return retirementReply(operation.key, copy);
  if (operation.kind === 'scanOutputDeletions') return pageReply(operation, copy);
  if (operation.kind === 'beginOutputDeletion' || operation.kind === 'getOutputDeletion' || operation.kind === 'reserveOutputCleanupControl') return summaryReply(operation, copy);
  return fileReply(operation,copy);
}

function bindPlan(value: OutputDeletionFile, expected: {record: OutputDeletionFile['record']; deletionId: string; deletionVersion: number; namespaceIdentity: string; preparationIdentity: string}): void {
  const actual = {record: value.record, deletionId: value.deletionId, deletionVersion: value.deletionVersion, namespaceIdentity: value.namespaceIdentity, preparationIdentity: value.preparationIdentity};
  const plan = {record: expected.record, deletionId: expected.deletionId, deletionVersion: expected.deletionVersion,
    namespaceIdentity: expected.namespaceIdentity, preparationIdentity: expected.preparationIdentity};
  requireRule(encodeCanonicalJson(actual, 8192) === encodeCanonicalJson(plan, 8192));
}

function summaryReply(operation: Extract<OutputDeletionOperation, {kind: 'beginOutputDeletion' | 'getOutputDeletion' | 'reserveOutputCleanupControl'}>, input: unknown): OutputDeletionSummary {
  const value = summary(input); const key = operation.kind === 'beginOutputDeletion' ? operation.command.request : operation.key;
  requireRule(value.runId === uuid(key.runId) && value.scope.organizationId === scope(key.scope).organizationId && value.scope.workspaceId === scope(key.scope).workspaceId);
  if (operation.kind !== 'beginOutputDeletion') requireRule(value.id === operation.key.id);
  else requireRule(value.requestId === operation.command.request.requestId.toLowerCase() && value.runVersion === operation.command.request.expectedRunVersion);
  return value;
}
function pageReply(operation: Extract<OutputDeletionOperation, {kind: 'scanOutputDeletions'}>, input: unknown): {items: OutputDeletionSummary[]; nextCursor: string | null} {
  closed(input, ['items','nextCursor']); requireRule(Array.isArray(input.items) && input.items.length <= operation.query.limit);
  const items = (input.items as unknown[]).map(item => summary(item));
  requireRule(items.every(item => item.stage === 'pending') && new Set(items.map(item => item.id)).size === items.length);
  requireRule(input.nextCursor === null || (typeof input.nextCursor === 'string' && items.length === operation.query.limit));
  const nextCursor = input.nextCursor as string | null;
  if (nextCursor !== null) requireRule(position({limit: operation.query.limit, cursor: nextCursor}) > position(operation.query));
  return {items, nextCursor};
}

function retirementReply(key: OutputDeletionKey, input: unknown) {
  const value = captureOutputRetirementRequest(input);
  requireRule(value.runId === key.runId && value.deletionId === key.id && value.organizationId === key.scope.organizationId && value.workspaceId === key.scope.workspaceId);
  return value;
}

function ackWriteReply(request:Extract<OutputDeletionOperation,{kind:'recordOutputCleanupAck'}>['request'],input:unknown){
 const value=captureCleanupAck(request.key,input);
 requireRule(encodeCanonicalJson(value.reply,4096)===encodeCanonicalJson(request.reply,4096));return value;
}

function fileReply(operation:Extract<OutputDeletionOperation,{kind:'getOutputDeletionFile'|'recordOutputDeletionPlan'|'recordOutputDeletionAbsence'}>,input:unknown):OutputDeletionFile{
 const value=file(input);bindFile(value,operation.kind==='getOutputDeletionFile'?operation.key:operation.request.key);
 if(operation.kind==='recordOutputDeletionPlan'){requireRule(value.phase!=='pending_preparation');bindPlan(value,operation.request.plan);}
 if(operation.kind==='recordOutputDeletionAbsence'){requireRule(value.phase==='absent');bindPlan(value,operation.request.receipt);}
 return value;
}
