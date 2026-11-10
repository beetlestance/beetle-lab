import type { EventBinding } from './events.js';
import type { OutputArtifactStore } from './output-artifacts.js';
import type { OutputByteStore } from './output-bytes.js';
import type { RunnerOutputGateway } from './output-source.js';

export type OutputTransferOutcome = { readonly kind: 'pending' } | {
  readonly kind: 'published';
  readonly binding: EventBinding;
  readonly manifestDigest: string;
  readonly sourceDigest: string;
};
export interface OutputTransferJob {
  readonly result: Promise<OutputTransferOutcome>;
  /** Unknown native close retains this original and its credit. */
  readonly settled: Promise<void>;
}
export interface OutputTransferOptions {
  readonly metadata: Pick<OutputArtifactStore, 'load' | 'readSource' | 'adopt' | 'claimArtifact' | 'recordProgress' | 'beginPublication' | 'recordPublication'>;
  readonly gateway: Pick<RunnerOutputGateway, 'output'>;
  readonly files: Pick<OutputByteStore, 'prepare' | 'append' | 'publish'>;
  readonly freeSpaceReserveBytes: number;
  readonly newWriterId: () => string;
  readonly monotonicNow?: () => number;
}
export type OutputTransferCode = 'invalid_input' | 'busy' | 'closed' | 'cancelled' |
  'source_unavailable' | 'transport' | 'conflict' | 'integrity' | 'storage' | 'cleanup';
export class OutputTransferError extends Error {
  constructor(readonly code: OutputTransferCode) {
    super('Output transfer failed'); this.name = 'OutputTransferError';
  }
}
/** One parent owner per byte-store instance. No engine execution, result projection,
 * dependency shutdown, disk refund or source deletion is exposed by this service.
 */
export interface OutputTransfers {
  transfer(binding: EventBinding, signal?: AbortSignal): OutputTransferJob;
  /** Cached fence/drain of this owner's originals; injected dependencies stay open. */
  close(): Promise<void>;
}
