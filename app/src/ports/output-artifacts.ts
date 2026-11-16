import type { OutputBinding } from '../domain/output-owner/index.js';
import type { EventBinding } from './events.js';
import type { OutputFileReceipt, OutputFileRecord } from './output-bytes.js';
import type { OutputCustodyStore } from './output-custody.js';

export const OUTPUT_ARTIFACT_REQUEST_BYTES = 4096;
export const OUTPUT_ARTIFACT_REPLY_BYTES = 4096;
export interface OutputArtifactKey<B extends OutputBinding = EventBinding> {
  readonly binding: B;
  readonly manifestDigest: string;
  readonly sourceDigest: string;
  readonly ordinal: number;
}
export interface OutputArtifactClaim<B extends OutputBinding = EventBinding> {
  readonly key: OutputArtifactKey<B>;
  readonly writerId: string;
  readonly expectedVersion: number;
}
export interface OutputArtifactProgress<B extends OutputBinding = EventBinding> extends OutputArtifactClaim<B> {
  readonly receipt: OutputFileReceipt;
}
/** Private storage extension. The transfer owner holds the real native namespace
 * lease and retains every HTTP/file original. SQL writer IDs never prove death or
 * authorize replacement by timeout. Recover the same stored logical writer.
 */
export interface OutputArtifactStore<B extends OutputBinding = EventBinding> extends OutputCustodyStore<B> {
  claimArtifact(request: OutputArtifactClaim<B>): Promise<OutputFileRecord<B>>;
  recordProgress(request: OutputArtifactProgress<B>): Promise<OutputFileRecord<B>>;
  beginPublication(request: OutputArtifactClaim<B>): Promise<OutputFileRecord<B>>;
  /** Caller fences the artifact producer and awaits native result AND settlement
   * before this call. This records the exact published native receipt, never an
   * application-supplied success flag, and clears the logical writer atomically.
   */
  recordPublication(request: OutputArtifactProgress<B>): Promise<OutputFileRecord<B>>;
}
