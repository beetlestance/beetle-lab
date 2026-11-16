import type { Artifact } from '@beetle/contracts';
import type { OutputCollectionReason, OutputRootIdentity } from './types.js';

/** Trusted stored source facts, captured before asynchronous work. */
export interface OutputRangeOptions {
  readonly root: Readonly<OutputRootIdentity>;
  readonly artifact: Readonly<Artifact>;
  readonly offset: number;
  readonly length: number;
  /** Fresh performance.now deadline, at most OUTPUT_COLLECTION_MAX_MS away. */
  readonly deadline: number;
  readonly signal?: AbortSignal;
}
export type OutputRangeResult = { readonly ok: true; readonly value: Uint8Array }
  | { readonly ok: false; readonly reason: OutputCollectionReason };
export interface OutputRange {
  /** Success only after exact range/custody checks and all original closes. */
  readonly result: Promise<OutputRangeResult>;
  /** All issued original IO/close work settled, including after a failed result. */
  readonly quiesced: Promise<void>;
  /** Cached cancellation/cleanup; failed original descriptor close stays rejected. */
  close(): Promise<void>;
}
export type OutputRangeReader = (options: OutputRangeOptions) => OutputRange;
