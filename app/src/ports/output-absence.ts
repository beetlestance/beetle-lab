import type { Owned, OutputAbsence } from '@beetle/contracts/output-source';
import type { ClientResult } from '@beetle/contracts';
import type { EventBinding } from './events.js';
import type { OutputFinalizationReceipt } from './output-finalization.js';
import type { RunnerAttemptIdentity } from './runner.js';
import type { RunnerOutputClient, RunnerOutputGateway } from './output-source.js';

export const OUTPUT_ABSENCE_OPERATION_BYTES = 4096;
export interface RunnerOutputAbsenceClient {
  absence(signal?: AbortSignal): Promise<ClientResult<Owned<OutputAbsence>>>;
}
/** The same installation connection and original-call credits, not another pool. */
export interface RunnerOutputAbsenceGateway extends RunnerOutputGateway {
  output(identity: RunnerAttemptIdentity): RunnerOutputClient & RunnerOutputAbsenceClient;
}
export interface OutputAbsenceState {
  readonly binding: EventBinding;
  readonly proofDigest: string;
  readonly closure: Owned<OutputAbsence>;
}
export interface OutputAbsenceAdoptRequest {
  readonly binding: EventBinding;
  readonly closure: unknown;
}
export interface OutputAbsenceFinalizeRequest {
  readonly binding: EventBinding;
  readonly proofDigest: string;
  readonly expectedRunVersion: number;
}
export type OutputAbsenceFinalizationReceipt = Omit<OutputFinalizationReceipt,
  'sourceDigest' | 'manifestDigest' | 'state' | 'outcome' | 'reason' | 'validationStatus'> & {
  readonly proofDigest: string;
  readonly state: 'cancelled' | 'errored';
  readonly outcome: 'inconclusive';
  readonly validationStatus: 'pending';
  readonly reason: NonNullable<OutputFinalizationReceipt['reason']>;
};
export type OutputAbsenceFinalizationReply = {
  readonly kind: 'finalized';
  readonly receipt: OutputAbsenceFinalizationReceipt;
} | { readonly kind: 'pending'; readonly reason: 'proof' | 'execution' | 'events' };
/** Sibling custody/settlement, never a fabricated source or source receipt.
 * All operations use the existing ordinary worker lane and4096-byte bounds.
 */
export interface OutputAbsenceStore {
  read(binding: EventBinding): Promise<OutputAbsenceState | null>;
  adopt(request: OutputAbsenceAdoptRequest): Promise<OutputAbsenceState>;
  finalize(request: OutputAbsenceFinalizeRequest): Promise<OutputAbsenceFinalizationReply>;
}
