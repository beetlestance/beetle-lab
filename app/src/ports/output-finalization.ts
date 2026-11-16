import type { Run } from '@beetle/contracts/api';
import type { EventBinding } from './events.js';

export const OUTPUT_FINALIZATION_REQUEST_BYTES = 4096;
export const OUTPUT_FINALIZATION_REPLY_BYTES = 4096;

export interface OutputFinalizationRequest {
  readonly binding: EventBinding;
  readonly sourceDigest: string;
  readonly manifestDigest: string;
  readonly expectedRunVersion: number;
}
/** Immutable credit and terminal projection; never another copy of the result. */
export interface OutputFinalizationReceipt {
  readonly binding: EventBinding;
  readonly sourceDigest: string;
  readonly manifestDigest: string;
  readonly finalAgentSeq: number;
  readonly retainedPayloadBytes: number;
  readonly refundedBytes: number;
  readonly runVersion: number;
  readonly state: 'finished' | 'cancelled' | 'errored';
  readonly outcome: 'passed' | 'failed' | 'inconclusive';
  readonly validationStatus: Run['validationStatus'];
  readonly reason: Run['reason'];
}
export type OutputFinalizationReply = {
  readonly kind: 'finalized';
  readonly receipt: OutputFinalizationReceipt;
} | {
  readonly kind: 'pending';
  readonly reason: 'source' | 'execution' | 'events' | 'artifacts' | 'exit_evidence';
};
/** One immediate metadata transaction. Matching committed receipts precede version
 * checks on retry. No file/network work, engine retry, source deletion or purge.
 */
export interface OutputFinalizations {
  finalize(request: OutputFinalizationRequest): Promise<OutputFinalizationReply>;
}
