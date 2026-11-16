import { createHash } from 'node:crypto';
import { encodeCanonicalJson, encodeJson, validatePrimitive } from '@beetle/contracts';
import { copyControlScope } from '../control-protocol/index.js';
import { captureCollectionIntent, prepareOutputSource, verifyOutputSource, receiptForOutputSource,
  OUTPUT_COLLECTION_INTENT_BYTES, OUTPUT_SOURCE_BYTES, OUTPUT_SOURCE_RECEIPT_BYTES } from '../output-source/index.js';
import type { SourceReceipt, CollectionIntent, PrivateSource } from '../output-source/index.js';
import type { Reservation, Scope } from '../admission/index.js';
import { FAILED_OUTPUT_COLLECTION_BYTES } from './output-source-protocol.js';
import type { FailedOutputCollection } from './output-source-protocol.js';
import { admissionInput } from './admission-input.js';
import { Failure } from './sql.js';

export const sourceHash = (text: string): string => createHash('sha256').update(text).digest('hex');
export function requireSource(condition: unknown, code: 'invalid_input' | 'conflict' | 'unavailable' = 'invalid_input'): asserts condition {
  if (!condition) throw new Failure(code);
}
function data(input: unknown, names: string): Record<string, unknown> {
  requireSource(input !== null && typeof input === 'object');
  requireSource([Object.prototype, null].includes(Object.getPrototypeOf(input) as object | null));
  const keys = Reflect.ownKeys(input); const expected = names.split(',').sort();
  requireSource(keys.length === expected.length && keys.every(key => typeof key === 'string'));
  requireSource((keys as string[]).sort().join(',') === expected.join(','));
  const copy: Record<string, unknown> = {};
  for (const key of keys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    requireSource(descriptor?.enumerable && 'value' in descriptor); copy[key] = descriptor.value;
  }
  return copy;
}
function uuid(value: unknown): void {
  requireSource(typeof value === 'string' && value.length === 36 && value === value.toLowerCase() && validatePrimitive('uuid', value).ok);
}
function text(value: unknown): void { requireSource(typeof value === 'string' && value.length > 0 && value.length <= 128); }
function hash(value: unknown): void { requireSource(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)); }
function time(value: unknown): void { requireSource(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0); }
export function sourceScope(input: unknown): Readonly<Scope> {
  return copyControlScope(data(input, 'organizationId,workspaceId,attemptId,generation'));
}
export function sourceJson(input: unknown, maximum: number): string { return encodeCanonicalJson(input, maximum); }
export function parseSourceJson(input: unknown, maximum: number): unknown {
  requireSource(typeof input === 'string' && input.length <= maximum);
  requireSource(Buffer.byteLength(input) <= maximum);
  try { return JSON.parse(input) as unknown; } catch { throw new Failure('invalid_input'); }
}
export function copyReceipt(input: unknown): SourceReceipt {
  const value = data(input, 'version,journalAuthority,key,manifestDigest,sourceDigest');
  requireSource(value.version === 1); uuid(value.journalAuthority); hash(value.manifestDigest); hash(value.sourceDigest);
  const key = sourceScope(value.key); requireSource(key.generation === 1);
  return freeze({ ...value, key }) as unknown as SourceReceipt;
}
export function copyFailed(input: unknown): FailedOutputCollection {
  const value = data(input, 'collectionId,evidence'); uuid(value.collectionId);
  const evidence = data(value.evidence, 'authority,key,createToken,specDigest,runtimeId,runtime,collection,launch');
  const runtime = data(evidence.runtime, 'state,source,observedAt,evidenceId');
  const collection = data(evidence.collection, 'state,observedAt,evidenceId');
  const launch = data(evidence.launch, 'epoch,startToken,settlementId');
  requireSource(evidence.authority === 'supervisor' && runtime.state === 'stopped' && runtime.source === 'supervisor');
  requireSource(collection.state === 'failed' && collection.evidenceId === value.collectionId);
  for (const item of [evidence.createToken, evidence.runtimeId, runtime.evidenceId, launch.settlementId]) text(item);
  hash(evidence.specDigest); time(runtime.observedAt); time(collection.observedAt);
  requireSource(launch.epoch === 0 || launch.epoch === 1);
  if (launch.epoch === 0) requireSource(launch.startToken === null); else text(launch.startToken);
  const copy = { collectionId: value.collectionId, evidence: { ...evidence, key: sourceScope(evidence.key), runtime, collection, launch } };
  const json = sourceJson(copy, FAILED_OUTPUT_COLLECTION_BYTES);
  const owned = JSON.parse(json) as FailedOutputCollection;
  requireSource(owned.evidence.key.generation === 1);
  admissionInput({ kind: 'release', evidence: owned.evidence }); return freeze(owned);
}
export function freeze<T>(input: T): T {
  if (input !== null && typeof input === 'object') { Object.values(input).forEach(freeze); Object.freeze(input); }
  return input;
}
export function sameSource(left: unknown, right: unknown): boolean { return sourceJson(left, OUTPUT_SOURCE_BYTES) === sourceJson(right, OUTPUT_SOURCE_BYTES); }
export function matchScope(value: Scope, key: Scope): void {
  for (const field of ['organizationId', 'workspaceId', 'attemptId', 'generation'] as const) requireSource(value[field] === key[field], 'unavailable');
}
export function intentReply(input: unknown, key: Scope): CollectionIntent {
  const value = captureCollectionIntent(input); matchScope(value.binding, key); return value;
}
export function sourceReply(input: unknown, key: Scope): PrivateSource {
  const value = verifyOutputSource(input, sourceHash); matchScope(value.manifest.binding, key); return value;
}
export function reservationReply(input: unknown, key: Scope): Reservation {
  const value = JSON.parse(encodeJson(input, 32_768)) as Reservation;
  sourceScope({ attemptId: value.attemptId, organizationId: value.organizationId, workspaceId: value.workspaceId, generation: value.generation });
  matchScope(value, key); requireSource(value.status === 'released' && value.releaseEvidence !== null, 'unavailable');
  admissionInput({ kind: 'release', evidence: value.releaseEvidence }); return freeze(value);
}
export const sourceCaps = { outputCollectionBegin: OUTPUT_COLLECTION_INTENT_BYTES, outputSourceCommit: OUTPUT_SOURCE_BYTES,
  outputSourceRelease: OUTPUT_SOURCE_RECEIPT_BYTES, outputCollectionFailed: FAILED_OUTPUT_COLLECTION_BYTES } as const;
export { captureCollectionIntent, prepareOutputSource, verifyOutputSource, receiptForOutputSource };
