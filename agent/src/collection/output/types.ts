import type { EngineResult } from '@beetle/contracts';
import type { ControlScope } from '../../control-protocol/index.js';

export const OUTPUT_RESULT_FILE = 'engine-result.json';
export const OUTPUT_RESULT_BYTES = 1_048_576;
export const OUTPUT_READ_BYTES = 65_536;
export const OUTPUT_COLLECTION_MAX_MS = 300_000;
export type OutputCollectionReason = 'invalid_options' | 'busy' | 'closed' | 'cancelled' | 'deadline'
  | 'io' | 'missing' | 'custody' | 'integrity' | 'result' | 'output_limit';
export interface OutputCollectionOptions {
  readonly directory: string;
  readonly uid: number;
  readonly key: Readonly<ControlScope>;
  readonly engineId: string;
  /** Journaled engine.result payload, still provisional until collection completes. */
  readonly reportedResult: Readonly<EngineResult>;
  /** Byte offset from the stopped_verified control cursor. */
  readonly controlBytes: number;
  readonly outputBytes: number;
  /** Trusted absolute performance.now() deadline, bounded by the remaining attempt budget. */
  readonly deadline: number;
  readonly signal?: AbortSignal;
}
export type OutputCollectionResult =
  | { readonly ok: true; readonly value: Readonly<EngineResult>; readonly verifiedBytes: number }
  | { readonly ok: false; readonly reason: OutputCollectionReason };
export interface OutputCollection {
  readonly result: Promise<OutputCollectionResult>;
  /** Every issued original filesystem operation and descriptor close has settled. */
  readonly quiesced: Promise<void>;
  /** Cached cancellation/cleanup outcome; an original descriptor-close failure stays rejected. */
  close(): Promise<void>;
}
export type OutputCollector = (options: OutputCollectionOptions) => OutputCollection;
