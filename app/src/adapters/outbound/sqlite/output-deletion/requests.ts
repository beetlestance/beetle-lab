import type { OutputDeletionOperation, OutputDeletionKey, OutputDeletionFileKey } from '../../../../ports/output-deletion-metadata.js';
import type { OutputDeletionRequest, OutputDeletionReceipt } from '../../../../ports/output-deletion.js';
import { prepareOutputDeletion } from '../../../../application/output-deletion/index.js';
import { captureEventBinding } from '../../../../domain/events/index.js';
import { requireRule } from '../../../../domain/namespaces/index.js';
import { decodeArtifact } from '../output-custody/index.js';
import { boundedCopy, sha256 } from '../input-values.js';
import { closed, hash, natural, scope, uuid } from './values.js';
const kinds = ['beginOutputDeletion', 'getOutputDeletion', 'getOutputDeletionFile', 'recordOutputDeletionPlan', 'recordOutputDeletionAbsence', 'scanOutputDeletions'];
export function deletionOperation(value: unknown): value is OutputDeletionOperation {
  const descriptor = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'kind') : undefined;
  return !!descriptor && 'value' in descriptor && kinds.includes(descriptor.value as string);
}
function key(value: unknown, file = false): OutputDeletionKey | OutputDeletionFileKey {
  closed(value, file ? ['scope', 'id', 'runId', 'ordinal'] : ['scope', 'id', 'runId']); const base = {scope: scope(value.scope), id: uuid(value.id), runId: uuid(value.runId)};
  if (!file) return base; natural(value.ordinal, 127); return {...base, ordinal: value.ordinal};
}
export function nativePlan(value: unknown, absent = false): OutputDeletionRequest | OutputDeletionReceipt {
  closed(value, ['record', 'deletionId', 'deletionVersion', 'namespaceIdentity', 'preparationIdentity', ...(absent ? ['phase'] : [])]);
  const deletionId = uuid(value.deletionId); requireRule(value.deletionVersion === 1);
  hash(value.namespaceIdentity); hash(value.preparationIdentity); closed(value.record, ['binding', 'artifact']);
  const record = {binding: captureEventBinding(value.record.binding), artifact: decodeArtifact(value.record.artifact)};
  requireRule(record.artifact.phase === 'published' && record.artifact.writer === null && record.artifact.identity !== null && record.artifact.offset === record.artifact.bytes);
  const plan = {record, deletionId, deletionVersion: 1 as const, namespaceIdentity: value.namespaceIdentity, preparationIdentity: value.preparationIdentity};
  if (!absent) return plan; requireRule(value.phase === 'absent'); return {...plan, phase: 'absent'};
}
function captureScan(value: unknown) {
  requireRule(value !== null && typeof value === 'object');
  closed(value, Object.hasOwn(value, 'cursor') ? ['limit', 'cursor'] : ['limit']); natural(value.limit, 32, 1);
  if (value.cursor !== undefined) requireRule(typeof value.cursor === 'string' && value.cursor.length <= 256);
  return {limit: value.limit, ...(value.cursor === undefined ? {} : {cursor: value.cursor as string})};
}
function captureWrite(kind: 'recordOutputDeletionPlan' | 'recordOutputDeletionAbsence', value: unknown): OutputDeletionOperation {
  const absent = kind === 'recordOutputDeletionAbsence'; closed(value, ['key', 'expectedVersion', absent ? 'receipt' : 'plan']);
  natural(value.expectedVersion, 3, 1); const owned = {key: key(value.key, true) as OutputDeletionFileKey, expectedVersion: value.expectedVersion};
  return absent ? {kind: 'recordOutputDeletionAbsence', request: {...owned, receipt: nativePlan(value.receipt, true) as OutputDeletionReceipt}}
    : {kind: 'recordOutputDeletionPlan', request: {...owned, plan: nativePlan(value.plan) as OutputDeletionRequest}};
}
const property: Record<OutputDeletionOperation['kind'], string> = {beginOutputDeletion: 'command', getOutputDeletion: 'key', getOutputDeletionFile: 'key',
  recordOutputDeletionPlan: 'request', recordOutputDeletionAbsence: 'request', scanOutputDeletions: 'query'};
export function captureDeletionOperation(input: unknown): OutputDeletionOperation {
  const copy = boundedCopy(input, 12288) as OutputDeletionOperation & {messageId?: number}; requireRule(deletionOperation(copy));
  closed(copy, ['kind', property[copy.kind], ...(Object.hasOwn(copy, 'messageId') ? ['messageId'] : [])]);
  if (Object.hasOwn(copy, 'messageId')) natural(copy.messageId, Number.MAX_SAFE_INTEGER, 1);
  switch (copy.kind) {
    case 'beginOutputDeletion': return {kind: copy.kind, command: prepareOutputDeletion(copy.command, sha256)};
    case 'getOutputDeletion': return {kind: copy.kind, key: key(copy.key)};
    case 'getOutputDeletionFile': return {kind: copy.kind, key: key(copy.key, true) as OutputDeletionFileKey};
    case 'scanOutputDeletions': return {kind: copy.kind, query: captureScan(copy.query)};
    default: return captureWrite(copy.kind, copy.request);
  }
}
