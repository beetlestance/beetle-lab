import { encodeCanonicalJson } from '@beetle/contracts';
import { validateApi } from '@beetle/contracts/api';
import type { RunHistoryJob, HistoryJobRetirement, HistoryRequest, HistoryOperation } from '../../../../ports/run-history.js';
import { boundedCopy, lower } from '../input-values.js';
import { StorageError } from '../protocol.js';
import { captureHistorySummary } from './values.js';

export type { HistoryOperation } from '../../../../ports/run-history.js';
function requireValue(value: unknown): asserts value { if (!value) throw new StorageError('invalid_input'); }
function closed(input: object, keys: string[]): void { requireValue(Object.keys(input).length === keys.length && Object.keys(input).every(key => keys.includes(key))); }
function time(value: unknown): asserts value is number { requireValue(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000); }
function digest(value: unknown): void { requireValue(value === null || (typeof value === 'string' && /^[a-f0-9]{64}$/.test(value))); }
export function captureHistoryJob(input: unknown): RunHistoryJob {
  const value = boundedCopy(input, 2048) as RunHistoryJob;
  closed(value, ['id', 'scope', 'attemptId', 'manifestDigest', 'sourceDigest', 'absenceProofDigest', 'expectedDueMs']);
  requireValue(validateApi('WorkspaceScope', value.scope).ok && validateApi('Uuid', value.id).ok && validateApi('Uuid', value.attemptId).ok);
  digest(value.manifestDigest); digest(value.sourceDigest); digest(value.absenceProofDigest); time(value.expectedDueMs);
  requireValue((value.manifestDigest === null) === (value.sourceDigest === null));
  requireValue(value.manifestDigest === null || value.absenceProofDigest === null);
  return { ...value, id: lower(value.id), attemptId: lower(value.attemptId), scope: { kind: 'workspace',
    organizationId: lower(value.scope.organizationId), workspaceId: lower(value.scope.workspaceId) } };
}
export function historyOperation(input: unknown): input is HistoryOperation {
  return !!input && typeof input === 'object' && Object.getOwnPropertyDescriptor(input, 'kind')?.value === 'historySummary';
}
export function captureHistoryOperation(input: unknown): HistoryOperation {
  const copy = boundedCopy(input, 4096) as HistoryOperation & { messageId?: number };
  requireValue(historyOperation(copy));
  if (copy.messageId !== undefined) { requireValue(Number.isSafeInteger(copy.messageId) && copy.messageId > 0); delete copy.messageId; }
  closed(copy, ['kind', 'operation']); const operation = copy.operation;
  if (operation.method === 'scan') {
    captureScan(operation); return copy;
  }
  if(operation.method==='retirement'){closed(operation,['method','request']);closed(operation.request,['job']);return{kind:copy.kind,operation:{method:'retirement',request:{job:captureHistoryJob(operation.request.job)}}};}
  requireValue(operation.method === 'defer' || operation.method === 'commit'); closed(operation, ['method', 'request']);
  const request = operation.request; const job = captureHistoryJob(request.job);
  if (operation.method === 'defer') {
    closed(operation.request, ['job', 'dueMs']); time(operation.request.dueMs); requireValue(operation.request.dueMs > job.expectedDueMs);
    return { kind: copy.kind, operation: { method: 'defer', request: { job, dueMs: operation.request.dueMs } } };
  }
  closed(operation.request, ['job', 'summary']); const summary = captureHistorySummary(operation.request.summary);
  requireValue(summary.runId === job.id && summary.attemptId === job.attemptId && summary.availability !== 'pending');
  requireValue(summary.retainedLogicalBytes === null && summary.metadataAllowanceBytes === null);
  return { kind: copy.kind, operation: { method: 'commit', request: { job, summary } } };
}
function captureScan(operation: Extract<HistoryRequest, { method: 'scan' }>): void {
  closed(operation, ['method', 'query']); closed(operation.query, ['nowMs', 'limit']); time(operation.query.nowMs);
  requireValue(Number.isInteger(operation.query.limit) && operation.query.limit >= 1 && operation.query.limit <= 16);
}
export function captureHistoryReply(input:HistoryOperation,output:unknown):RunHistoryJob[]|HistoryJobRetirement|null|ReturnType<typeof captureHistorySummary>{
 const copy:unknown=boundedCopy(output,16384);const operation=input.operation;
 if(operation.method==='scan')return historyPage(operation,copy);
 return historyWriteReply(operation,copy);
}
function historyWriteReply(operation:Exclude<HistoryRequest,{method:'scan'}>,copy:unknown){
 const retired=retirementValue(operation.request.job,copy,operation.method==='retirement');if(retired)return retired;
 if(operation.method==='retirement'||operation.method==='defer'){requireValue(copy===null);return null;}
 const summary=captureHistorySummary(copy);
 requireValue(encodeCanonicalJson(summary,2048)===encodeCanonicalJson(operation.request.summary,2048));return summary;
}
function retirementValue(job:RunHistoryJob,copy:unknown,deleting:boolean):HistoryJobRetirement|undefined{
 if(!copy||typeof copy!=='object')return undefined;const state=Reflect.get(copy,'state');
 if(state==='retired'||deleting&&state==='deleting')return retiredReply(job,copy);return undefined;
}
function historyPage(operation:Extract<HistoryRequest,{method:'scan'}>,copy:unknown):RunHistoryJob[]{
  requireValue(Array.isArray(copy) && copy.length <= operation.query.limit);
  const jobs = copy.map(captureHistoryJob); const ids = new Set<string>();
  let prior: RunHistoryJob | undefined;
  for (const job of jobs) {
    requireValue(job.expectedDueMs <= operation.query.nowMs && !ids.has(job.id)); ids.add(job.id);
    if (prior) requireValue(job.expectedDueMs > prior.expectedDueMs || (job.expectedDueMs === prior.expectedDueMs && job.id > prior.id));
    prior = job;
  }
  return jobs;
}

function retiredReply(job:RunHistoryJob,input:object):HistoryJobRetirement{
 closed(input,['state','id','scope','attemptId']);const row=input as HistoryJobRetirement;
 requireValue(['retired','deleting'].includes(row.state)&&row.id===job.id&&row.attemptId===job.attemptId
  &&encodeCanonicalJson(row.scope,512)===encodeCanonicalJson(job.scope,512));return row;
}
