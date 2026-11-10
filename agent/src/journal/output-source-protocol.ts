import type { ReleaseEvidence, Reservation, Scope } from '../admission/index.js';
import type { CollectionIntent, CollectedSource, Owned, PrivateSource, SourceReceipt,
  StoppedRuntime } from '../output-source/index.js';

export const FAILED_OUTPUT_COLLECTION_BYTES = 8192;
export interface FailedOutputCollection {
  readonly collectionId: string;
  readonly evidence: Owned<Omit<ReleaseEvidence, 'collection' | 'runtime'>> & {
    readonly runtime: StoppedRuntime;
    readonly collection: Owned<ReleaseEvidence['collection']> & { readonly state: 'failed' };
  };
}

/** Private trusted controller surface; no HTTP/wrapper route accepts these calls. */
export interface JournalOutputSources {
  beginOutputCollection(input: CollectionIntent): Promise<CollectionIntent>;
  readOutputCollection(key: Scope): Promise<CollectionIntent | null>;
  commitOutputSource(input: CollectedSource): Promise<SourceReceipt>;
  readOutputSource(key: Scope): Promise<PrivateSource | null>;
  releaseOutputSource(receipt: SourceReceipt): Promise<Reservation>;
  failOutputCollection(input: FailedOutputCollection): Promise<Reservation>;
}

/** Byte-capped JSON is checked before parsing/clone; clients cannot supply epochs. */
export type OutputSourceOperation =
  | { readonly kind: 'outputCollectionBegin'; readonly json: string }
  | { readonly kind: 'outputCollectionRead'; readonly key: Readonly<Scope> }
  | { readonly kind: 'outputSourceCommit'; readonly json: string }
  | { readonly kind: 'outputSourceRead'; readonly key: Readonly<Scope> }
  | { readonly kind: 'outputSourceRelease'; readonly json: string }
  | { readonly kind: 'outputCollectionFailed'; readonly json: string };
