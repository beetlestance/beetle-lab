import type { OutputBinding } from '../domain/output-owner/index.js';
import type { Owned, SourceEnvelope } from '@beetle/contracts/output-source';
import type { EventBinding, EventCandidate, EventScan } from './events.js';

export const OUTPUT_ADOPT_REQUEST_BYTES = 75_776 + 4096;
export const OUTPUT_STATE_BYTES = 65_536;
export const OUTPUT_SOURCE_BYTES = 75_776;
export const OUTPUT_CURSOR_BYTES = 1024;
export const OUTPUT_SCAN_LIMIT = 32;

/** One compact persisted slot; expected artifact values are derived from the
 * sole manifest. Native receipts, never this row alone, establish file custody.
 */
export interface OutputArtifactState {
  readonly ordinal: number;
  readonly artifactId: string;
  readonly token: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly offset: number;
  readonly phase: 'transferring' | 'publishing' | 'published';
  readonly identity: string | null;
  readonly writer: string | null;
  readonly version: number;
}
export type OutputCustodyState<B extends OutputBinding = EventBinding> = {
  readonly kind: 'pending';
  readonly binding: B;
} | {
  readonly kind: 'adopted';
  readonly binding: B;
  readonly manifestDigest: string;
  readonly sourceDigest: string;
  readonly finalAgentSeq: number;
  readonly version: number;
  readonly artifacts: readonly OutputArtifactState[];
};
export interface OutputPage {
  readonly items: readonly EventCandidate[];
  readonly nextCursor: string | null;
}
export interface OutputAdoptRequest<B extends OutputBinding = EventBinding> {
  readonly binding: B;
  /** Capture and validate this bounded foreign value before digest/SQL work. */
  readonly envelope: unknown;
}

/** Private metadata worker port. Adoption stores one canonical manifest and
 * compact closure/slots under the retained original. It does no network/file IO,
 * terminal projection, allocation refund or source deletion. Source-free closure
 * and artifact writer/publication methods are separate contracts.
 */
export interface OutputCustodyStore<B extends OutputBinding = EventBinding> {
  scan(query: EventScan): Promise<OutputPage>;
  load(binding: B): Promise<OutputCustodyState<B>>;
  readSource(binding: B): Promise<Owned<SourceEnvelope> | null>;
  adopt(request: OutputAdoptRequest<B>): Promise<OutputCustodyState<B>>;
}
