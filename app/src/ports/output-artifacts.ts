import type { EventBinding } from './events.js';
import type { OutputFileReceipt, OutputFileRecord } from './output-bytes.js';
import type { OutputCustodyStore } from './output-custody.js';

export const OUTPUT_ARTIFACT_REQUEST_BYTES = 4096;
export const OUTPUT_ARTIFACT_REPLY_BYTES = 4096;
export interface OutputArtifactKey {
  readonly binding: EventBinding;
  readonly manifestDigest: string;
  readonly sourceDigest: string;
  readonly ordinal: number;
}
export interface OutputArtifactClaim {
  readonly key: OutputArtifactKey;
  readonly writerId: string;
  readonly expectedVersion: number;
}
export interface OutputArtifactProgress extends OutputArtifactClaim {
  readonly receipt: OutputFileReceipt;
}
/** Private storage extension. The transfer owner holds the real native namespace
 * lease and retains every HTTP/file original. SQL writer IDs never prove death or
 * authorize replacement by timeout. Recover the same stored logical writer.
 */
export interface OutputArtifactStore extends OutputCustodyStore {
  claimArtifact(request: OutputArtifactClaim): Promise<OutputFileRecord>;
  recordProgress(request: OutputArtifactProgress): Promise<OutputFileRecord>;
  beginPublication(request: OutputArtifactClaim): Promise<OutputFileRecord>;
  /** Caller fences the artifact producer and awaits native result AND settlement
   * before this call. This records the exact published native receipt, never an
   * application-supplied success flag, and clears the logical writer atomically.
   */
  recordPublication(request: OutputArtifactProgress): Promise<OutputFileRecord>;
}
