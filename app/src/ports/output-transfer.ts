import type { ResultDigest } from '@beetle/contracts';
import type { EventBinding } from './events.js';
import type { OutputBinding } from '../domain/output-owner/index.js';
import type { OutputArtifactStore } from './output-artifacts.js';
import type { OutputByteStore } from './output-bytes.js';
import type { RunnerOutputGateway } from './output-source.js';

export type OutputTransferOutcome<B extends OutputBinding = EventBinding> = { readonly kind: 'pending' } | {
  readonly kind: 'published';
  readonly binding: B;
  readonly manifestDigest: string;
  readonly sourceDigest: string;
};
export interface OutputTransferJob<B extends OutputBinding = EventBinding> {
  readonly result: Promise<OutputTransferOutcome<B>>;
  /** Unknown native close retains this original and its credit. */
  readonly settled: Promise<void>;
}
export interface OutputTransferOptions<B extends OutputBinding = EventBinding> {
  readonly metadata: Pick<OutputArtifactStore<B>, 'load' | 'readSource' | 'adopt' | 'claimArtifact' | 'recordProgress' | 'beginPublication' | 'recordPublication'>;
  readonly gateway: Pick<RunnerOutputGateway, 'output'>;
  readonly files: Pick<OutputByteStore<B>, 'prepare' | 'append' | 'publish'>;
  readonly freeSpaceReserveBytes: number;
  readonly newWriterId: () => string;
  readonly monotonicNow?: () => number;
  /** Trusted content codec; required for purpose-bound export result verification. */
  readonly digest?: ResultDigest;
}
export type OutputTransferCode = 'invalid_input' | 'busy' | 'closed' | 'cancelled' |
  'source_unavailable' | 'source_absent' | 'transport' | 'conflict' | 'integrity' | 'storage' | 'cleanup';
export class OutputTransferError extends Error {
  constructor(readonly code: OutputTransferCode) {
    super('Output transfer failed'); this.name = 'OutputTransferError';
  }
}
/** One parent owner per byte-store instance. No engine execution, result projection,
 * dependency shutdown, disk refund or source deletion is exposed by this service.
 */
export interface OutputTransfers<B extends OutputBinding = EventBinding> {
  transfer(binding: B, signal?: AbortSignal): OutputTransferJob<B>;
  /** Cached fence/drain of this owner's originals; injected dependencies stay open. */
  close(): Promise<void>;
}
