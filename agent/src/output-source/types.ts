import type { EngineResult, Offer, ResultDigest } from '@beetle/contracts';
import type { LaunchSettlement, ReleaseEvidence, Scope } from '../admission/index.js';
import type { OutputCollectionResult, OutputRootIdentity } from '../collection/output/index.js';
import type { WrapperCheckpoint } from '../control-protocol/index.js';

/** Owned recursive snapshots; capture and freeze are required at runtime too. */
export type Owned<T> = T extends readonly (infer Item)[] ? readonly Owned<Item>[]
  : T extends object ? { readonly [Key in keyof T]: Owned<T[Key]> } : T;
export type SourceScope = Readonly<Omit<Scope, 'generation'>> & { readonly generation: 1 };
export interface SourceBinding extends SourceScope {
  readonly journalAuthority: string;
  readonly intentDigest: string;
  readonly engine: Owned<Offer['engine']>;
  readonly installedIdentity: Owned<Offer['installedIdentity']>;
  readonly specDigest: string;
}
export type StoppedRuntime = Owned<ReleaseEvidence['runtime']> & { readonly state: 'stopped' };
export type FinishedRelease = Owned<Omit<ReleaseEvidence, 'runtime' | 'collection'>> & {
  readonly runtime: StoppedRuntime;
  readonly collection: Owned<ReleaseEvidence['collection']> & { readonly state: 'finished' };
};
export type SettledLaunch = Owned<LaunchSettlement> & { readonly disposition: 'completed' | 'retired' };
export interface PublicCore {
  readonly version: 1;
  readonly binding: SourceBinding;
  readonly result: Owned<EngineResult>;
  readonly resultFileBytes: number;
  readonly controlBytes: number;
  readonly verifiedBytes: number;
}
export interface PublicManifest extends PublicCore { readonly manifestDigest: string }
export interface PrivateCore {
  readonly version: 1;
  readonly manifest: PublicManifest;
  readonly root: Readonly<OutputRootIdentity>;
  readonly checkpoint: Readonly<WrapperCheckpoint>;
  readonly release: FinishedRelease;
}
export interface PrivateSource extends PrivateCore { readonly sourceDigest: string }
export interface SourceReceipt {
  readonly version: 1;
  readonly journalAuthority: string;
  readonly key: SourceScope;
  readonly manifestDigest: string;
  readonly sourceDigest: string;
}
export interface CollectedSource {
  readonly collectionId: string;
  readonly binding: SourceBinding;
  readonly collection: Owned<Extract<OutputCollectionResult, { readonly ok: true }>>;
  readonly checkpoint: Readonly<WrapperCheckpoint>;
  readonly release: FinishedRelease;
}
export interface CollectionIntent {
  readonly version: 1;
  readonly collectionId: string;
  readonly binding: SourceBinding;
  readonly root: Readonly<OutputRootIdentity>;
  readonly checkpoint: Readonly<WrapperCheckpoint>;
  readonly launch: SettledLaunch;
  readonly runtime: StoppedRuntime;
  readonly begunAt: number;
}

/** Pure boundaries; no native operation, durable authority or release permission. */
export type CaptureCollectionIntent = (input: unknown) => CollectionIntent;
export type PrepareOutputSource = (input: unknown, digest: ResultDigest) => PrivateSource;
export type VerifyOutputSource = (input: unknown, digest: ResultDigest) => PrivateSource;
export type ReceiptForOutputSource = (input: unknown, digest: ResultDigest) => SourceReceipt;
