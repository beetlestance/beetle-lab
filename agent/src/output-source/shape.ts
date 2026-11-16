import { integer, text, sha, uuid, scope, sameScope } from '@beetle/contracts/output-source/internal';
export { integer, text, sha, uuid, scope, sameScope, binding, result, counts } from '@beetle/contracts/output-source/internal';
import { captureCollectionRootIdentity } from '../collection/root/index.js';
import type { OutputRootIdentity } from '../collection/output/index.js';
import { copyWrapperCheckpoint } from '../control-protocol/index.js';
import type { WrapperCheckpoint } from '../control-protocol/index.js';
import { fields, requireInput } from './capture.js';
import type { SourceBinding, StoppedRuntime, FinishedRelease, SettledLaunch } from './types.js';

export function checkpoint(input: unknown): Readonly<WrapperCheckpoint> { return copyWrapperCheckpoint(input); }
export function root(input: unknown): Readonly<OutputRootIdentity> {
  try { return captureCollectionRootIdentity(input); }
  catch { requireInput(false); }
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
