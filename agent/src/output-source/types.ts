import type { ResultDigest, ExecutionResult } from '@beetle/contracts';
import type { Owned, SourceBinding, PublicManifest, SourceReceipt } from '@beetle/contracts/output-source';
export type { Owned, SourceScope, SourceBinding, PublicCore, PublicManifest, SourceReceipt } from '@beetle/contracts/output-source';
import type { LaunchSettlement, ReleaseEvidence } from '../admission/index.js';
import type { OutputCollectionResult, OutputRootIdentity } from '../collection/output/index.js';
import type { WrapperCheckpoint } from '../control-protocol/index.js';

export type StoppedRuntime = Owned<ReleaseEvidence['runtime']> & { readonly state: 'stopped' };
export type FinishedRelease = Owned<Omit<ReleaseEvidence, 'runtime' | 'collection'>> & {
  readonly runtime: StoppedRuntime;
  readonly collection: Owned<ReleaseEvidence['collection']> & { readonly state: 'finished' };
};
export type SettledLaunch = Owned<LaunchSettlement> & { readonly disposition: 'completed' | 'retired' };
export interface PrivateCore<T extends ExecutionResult = ExecutionResult> {
  readonly version: 1;
  readonly manifest: PublicManifest<T>;
  readonly root: Readonly<OutputRootIdentity>;
  readonly checkpoint: Readonly<WrapperCheckpoint>;
  readonly release: FinishedRelease;
}
export interface PrivateSource<T extends ExecutionResult = ExecutionResult> extends PrivateCore<T> { readonly sourceDigest: string }
export interface CollectedSource<T extends ExecutionResult = ExecutionResult> {
  readonly collectionId: string;
  readonly binding: SourceBinding;
  readonly collection: Owned<Extract<OutputCollectionResult<T>, { readonly ok: true }>>;
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

/**
 * Private codecs consume already bounded, application-owned producer/parsed data.
 * Original serialized bytes must be bounded before parsing/worker cloning; native
 * key reflection on arbitrary foreign JS graphs has no hard allocation bound here.
 * Strict value/copy/encoding gates remain enforced; no durable/release authority.
 */
export type CaptureCollectionIntent = (input: unknown) => CollectionIntent;
export type PrepareOutputSource = (input: unknown, digest: ResultDigest) => PrivateSource;
export type VerifyOutputSource = (input: unknown, digest: ResultDigest) => PrivateSource;
export type ReceiptForOutputSource = (input: unknown, digest: ResultDigest) => SourceReceipt;
