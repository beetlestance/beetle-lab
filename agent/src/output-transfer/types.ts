import type { Owned, SourceChunk, SourceChunkRequest, SourceEnvelope } from '@beetle/contracts/output-source';
import type { Scope } from '../admission/index.js';
import type { Operation } from '../backends/docker/index.js';
import type { Journal } from '../journal/index.js';
import type { OutputRangeReader } from '../collection/output/index.js';

/** Private source reader port. Source and chunk both require an exact durable
 * source plus closure; neither operation creates closure or launches work.
 * Promises retain all original Journal/file reads and cached closes until settled,
 * including after caller cancellation. HTTP owns pre-body/request/socket credits.
 */
export interface OutputSourceReader {
  source(key: Scope, operation: Operation): Promise<Owned<SourceEnvelope>>;
  chunk(key: Scope, request: SourceChunkRequest, operation: Operation): Promise<Owned<SourceChunk>>;
}

export interface OutputSourceReaderOptions {
  readonly journal: Pick<Journal, 'readOutputSource' | 'readOutputDelivery' | 'get' | 'journalAuthority'>;
  /** Exact public native range owner; no engine/catalogue lookup or new IO pool. */
  readonly readRange: OutputRangeReader;
  readonly monotonicNow?: () => number;
}
export type CreateOutputSourceReader = (options: OutputSourceReaderOptions) => OutputSourceReader;
