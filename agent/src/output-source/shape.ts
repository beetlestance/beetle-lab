import { validate, validatePrimitive } from '@beetle/contracts';
import type { EngineResult } from '@beetle/contracts';
import { isAbsolute, normalize } from 'node:path';
import type { OutputRootIdentity } from '../collection/output/index.js';
import { copyControlScope, copyWrapperCheckpoint } from '../control-protocol/index.js';
import type { WrapperCheckpoint } from '../control-protocol/index.js';
import { fields, requireInput, canonical } from './capture.js';
import { OUTPUT_SOURCE_RESULT_BYTES } from './limits.js';
import type { SourceScope, SourceBinding, StoppedRuntime, FinishedRelease, SettledLaunch } from './types.js';

export function integer(value: unknown, maximum = Number.MAX_SAFE_INTEGER, minimum = 0): asserts value is number {
  requireInput(typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum);
}
export function text(value: unknown): asserts value is string {
  requireInput(typeof value === 'string' && value.length > 0 && value.length <= 128);
}
export function sha(value: unknown): asserts value is string {
  requireInput(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value));
}
export function uuid(value: unknown): asserts value is string {
  requireInput(typeof value === 'string' && value.length === 36 && validatePrimitive('uuid', value).ok && value === value.toLowerCase());
}
export function scope(input: unknown): SourceScope {
  const value = copyControlScope(input); requireInput(value.generation === 1);
  return value as SourceScope;
}
export function sameScope(value: SourceScope, expected: SourceScope): void {
  for (const key of ['organizationId', 'workspaceId', 'attemptId', 'generation'] as const) requireInput(value[key] === expected[key]);
}
export function checkpoint(input: unknown): Readonly<WrapperCheckpoint> { return copyWrapperCheckpoint(input); }
export function binding(input: unknown): SourceBinding {
  const value = fields(input, 'journalAuthority,organizationId,workspaceId,attemptId,generation,intentDigest,engine,installedIdentity,specDigest');
  scope({ organizationId: value.organizationId, workspaceId: value.workspaceId, attemptId: value.attemptId, generation: value.generation });
  uuid(value.journalAuthority); sha(value.intentDigest); sha(value.specDigest);
  const engine = fields(value.engine, 'id,imageDigest,configVersion');
  requireInput(typeof engine.id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(engine.id));
  requireInput(typeof engine.imageDigest === 'string' && /^sha256:[a-f0-9]{64}$/.test(engine.imageDigest));
  integer(engine.configVersion, Number.MAX_SAFE_INTEGER, 1);
  requireInput(validate('InstalledIdentity', value.installedIdentity).ok);
  return value as unknown as SourceBinding;
}
function uint64(value: unknown): void {
  requireInput(typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value));
  requireInput(BigInt(value) <= 18_446_744_073_709_551_615n);
}
function nanoseconds(value: unknown): void {
  requireInput(typeof value === 'string' && value.length <= 32 && /^(0|-?[1-9][0-9]*)$/.test(value));
}
export function root(input: unknown): Readonly<OutputRootIdentity> {
  const value = fields(input, 'directory,uid,device,inode,modifiedNs,changedNs');
  requireInput(typeof value.directory === 'string');
  requireInput(isAbsolute(value.directory) && normalize(value.directory) === value.directory);
  requireInput(!value.directory.includes('\u0000') && new TextEncoder().encode(value.directory).byteLength <= 4096);
  integer(value.uid, 4_294_967_295); uint64(value.device); uint64(value.inode);
  nanoseconds(value.modifiedNs); nanoseconds(value.changedNs);
  return value as unknown as Readonly<OutputRootIdentity>;
}
export function runtime(input: unknown): StoppedRuntime {
  const value = fields(input, 'state,source,observedAt,evidenceId');
  requireInput(value.state === 'stopped' && value.source === 'supervisor');
  integer(value.observedAt); text(value.evidenceId);
  return value as unknown as StoppedRuntime;
}
export function launchIdentity(input: unknown, names: string): Record<string, unknown> {
  const value = fields(input, names);
  requireInput(value.epoch === 0 || value.epoch === 1);
  if (value.epoch === 0) requireInput(value.startToken === null); else text(value.startToken);
  return value;
}
export function launch(input: unknown, original: SourceBinding): SettledLaunch {
  const value = launchIdentity(input, 'authority,key,createToken,specDigest,runtimeId,epoch,startToken,disposition,settledAt,evidenceId');
  requireInput(value.authority === 'supervisor'); sameScope(scope(value.key), original);
  text(value.createToken); text(value.runtimeId); text(value.evidenceId); sha(value.specDigest);
  requireInput(value.specDigest === original.specDigest);
  integer(value.settledAt, 8_640_000_000_000_000);
  requireInput(value.disposition === 'retired' || value.epoch === 1 && value.disposition === 'completed');
  return value as unknown as SettledLaunch;
}
export function release(input: unknown, binding: SourceBinding): FinishedRelease {
  const value = fields(input, 'authority,key,createToken,specDigest,runtimeId,runtime,collection,launch');
  requireInput(value.authority === 'supervisor'); sameScope(scope(value.key), binding);
  text(value.createToken); text(value.runtimeId); sha(value.specDigest);
  requireInput(value.specDigest === binding.specDigest);
  const stopped = runtime(value.runtime);
  const collection = fields(value.collection, 'state,observedAt,evidenceId');
  requireInput(collection.state === 'finished'); integer(collection.observedAt); uuid(collection.evidenceId);
  requireInput(collection.observedAt >= stopped.observedAt);
  const launch = launchIdentity(value.launch, 'epoch,startToken,settlementId'); text(launch.settlementId);
  return value as unknown as FinishedRelease;
}
export function result(input: unknown, binding: SourceBinding): EngineResult {
  canonical(input, OUTPUT_SOURCE_RESULT_BYTES);
  const checked = validate('EngineResult', input); requireInput(checked.ok);
  const value = checked.value;
  sameScope(value as SourceScope, binding); requireInput(value.engineId === binding.engine.id);
  return value;
}
export function counts(input: { resultFileBytes: unknown; controlBytes: unknown; verifiedBytes: unknown }, result: EngineResult): void {
  integer(input.resultFileBytes, 1_048_576, 1); integer(input.controlBytes, 67_108_864); integer(input.verifiedBytes);
  let total = input.resultFileBytes + input.controlBytes;
  for (const artifact of result.artifacts) {
    requireInput(artifact.bytes <= Number.MAX_SAFE_INTEGER - total); total += artifact.bytes;
  }
  requireInput(input.verifiedBytes === total);
}
