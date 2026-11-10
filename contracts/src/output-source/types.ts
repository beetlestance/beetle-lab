import type { EngineResult, Offer } from '../generated/types.js';
import type { ResultDigest } from '../result-seal.js';

export type Owned<T> = T extends readonly (infer Item)[] ? readonly Owned<Item>[]
  : T extends object ? { readonly [Key in keyof T]: Owned<T[Key]> } : T;
export interface SourceScope {
  readonly organizationId: string;
  readonly workspaceId: string;
  readonly attemptId: string;
  readonly generation: 1;
}
export interface SourceBinding extends SourceScope {
  readonly journalAuthority: string;
  readonly intentDigest: string;
  readonly engine: Owned<Offer['engine']>;
  readonly installedIdentity: Owned<Offer['installedIdentity']>;
  readonly specDigest: string;
}
export interface PublicCore {
  readonly version: 1;
  readonly binding: SourceBinding;
  readonly result: Owned<EngineResult>;
  readonly resultFileBytes: number;
  readonly controlBytes: number;
  readonly verifiedBytes: number;
}
export interface PublicManifest extends PublicCore { readonly manifestDigest: string }
export interface SourceReceipt {
  readonly version: 1;
  readonly journalAuthority: string;
  readonly key: SourceScope;
  readonly manifestDigest: string;
  readonly sourceDigest: string;
}
/** Already bounded owned producer/byte-bounded parsed values; no native authority. */
export type PrepareOutputManifest = (input: unknown, digest: ResultDigest) => PublicManifest;
export type VerifyOutputManifest = (input: unknown, digest: ResultDigest) => PublicManifest;
