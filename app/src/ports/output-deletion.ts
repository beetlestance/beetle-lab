import type { OutputFileContext, OutputFileJob, OutputFileRecord } from './output-bytes.js';
export const OUTPUT_DELETION_BYTES = 8192;
/** Metadata-owned committed intent; never construct from public caller paths. */
export interface OutputDeletionIntent {
  readonly record: OutputFileRecord;
  readonly deletionId: string;
  readonly deletionVersion: number;
}
export interface OutputDeletionRequest extends OutputDeletionIntent {
  readonly namespaceIdentity: string;
  readonly preparationIdentity: string;
}
export interface OutputDeletionReceipt extends OutputDeletionRequest {readonly phase: 'absent'}
/** Same native instance/lease/token admission as OutputByteStore. A positive
 * receipt includes original closes and post-close namespace/absence checks.
 * Does not create deletion intent, mutate metadata or release storage charges.
 */
export interface OutputDeletionStore {
  /** Requires present verified bytes; persist this plan before removal. */
  prepareRemoval(intent: OutputDeletionIntent, context: OutputFileContext): OutputFileJob<OutputDeletionRequest>;
  remove(request: OutputDeletionRequest, context: OutputFileContext): OutputFileJob<OutputDeletionReceipt>;
}
