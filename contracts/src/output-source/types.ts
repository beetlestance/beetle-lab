import type { SourceBinding as WireBinding, OutputManifestCore, OutputManifest, SourceEnvelope as WireEnvelope, ExecutionResult } from '../generated/types.js';
import type { ResultDigest } from '../result-seal.js';

export type Owned<T> = T extends readonly (infer Item)[] ? readonly Owned<Item>[]
  : T extends object ? { readonly [Key in keyof T]: Owned<T[Key]> } : T;
export interface SourceScope {
  readonly organizationId: string;
  readonly workspaceId: string;
  readonly attemptId: string;
  readonly generation: 1;
}
export type SourceBinding = Owned<WireBinding>;
export type PublicCore<T extends ExecutionResult = ExecutionResult> = Owned<Omit<OutputManifestCore,'result'> & {result:T}>;
export type PublicManifest<T extends ExecutionResult = ExecutionResult> = Owned<Omit<OutputManifest,'result'> & {result:T}>;
export type SourceEnvelope<T extends ExecutionResult = ExecutionResult> = Omit<WireEnvelope,'manifest'> & {manifest:Omit<OutputManifest,'result'> & {result:T}};
export type SourceReceipt = Owned<SourceEnvelope['closure']['receipt']>;
export type OutputDeliveryClosure = Owned<SourceEnvelope['closure']>;
/** Already bounded owned producer/byte-bounded parsed values; no native authority. */
export type PrepareOutputManifest = (input: unknown, digest: ResultDigest) => PublicManifest;
export type VerifyOutputManifest = (input: unknown, digest: ResultDigest) => PublicManifest;
