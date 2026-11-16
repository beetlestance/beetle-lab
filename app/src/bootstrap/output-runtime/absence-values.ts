import { createHash } from 'node:crypto';
import { encodeCanonicalJson, encodeJson } from '@beetle/contracts';
import { captureOutputAbsence } from '@beetle/contracts/output-source';
import type { Run } from '@beetle/contracts/api';
import { validateApi } from '@beetle/contracts/api';
import { captureEventBinding } from '../../domain/events/index.js';
import { mergeAttemptObservation, MAX_ATTEMPT_OBSERVATION_BYTES } from '../../domain/runs/index.js';
import type { EventBinding } from '../../ports/events.js';
import type { OutputAbsenceFinalizeRequest, OutputAbsenceFinalizationReply, OutputAbsenceState } from '../../ports/output-absence.js';
import { discriminator, fields, integer, requireValue, sameBinding } from './validation.js';

export function absenceState(input: OutputAbsenceState, binding: EventBinding): OutputAbsenceState {
  const value = fields(input, ['binding', 'proofDigest', 'closure']);
  encodeJson(input, 4096);
  requireValue(sameBinding(captureEventBinding(value.binding), binding));
  const closure = captureOutputAbsence(value.closure, {...binding.key.attempt, journalAuthority: binding.journalAuthority});
  const proofDigest = createHash('sha256').update(encodeCanonicalJson(closure, 2048)).digest('hex');
  requireValue(value.proofDigest === proofDigest);
  return Object.freeze({binding, proofDigest, closure});
}
export function absenceFinalization(input: OutputAbsenceFinalizationReply, request: OutputAbsenceFinalizeRequest,
  state: OutputAbsenceState, run: Run): 'execution' | 'done' {
  encodeJson(input, 4096);
  const value = fields(input, discriminator(input) === 'pending' ? ['kind', 'reason'] : ['kind', 'receipt']);
  if (value.kind === 'pending') {
    requireValue(['proof', 'execution', 'events'].includes(value.reason as string));
    return value.reason === 'execution' ? 'execution' : 'done';
  }
  requireValue(value.kind === 'finalized');
  const receipt = fields(value.receipt, ['binding', 'proofDigest', 'finalAgentSeq', 'retainedPayloadBytes',
    'refundedBytes', 'runVersion', 'state', 'outcome', 'validationStatus', 'reason']);
  requireValue(sameBinding(captureEventBinding(receipt.binding), request.binding) && receipt.proofDigest === request.proofDigest);
  integer(receipt.finalAgentSeq); integer(receipt.retainedPayloadBytes); integer(receipt.refundedBytes); integer(receipt.runVersion, 2);
  requireValue(receipt.finalAgentSeq === state.closure.finalAgentSeq
    && Number.isSafeInteger(receipt.retainedPayloadBytes + receipt.refundedBytes));
  requireValue(receipt.outcome === 'inconclusive' && receipt.validationStatus === 'pending');
  terminal(receipt, run);
  requireValue(validateApi('Run', {...run, version: receipt.runVersion, state: receipt.state, outcome: receipt.outcome,
    validationStatus: receipt.validationStatus, reason: receipt.reason}).ok);
  return 'done';
}
export function boundSnapshot(input: unknown, binding: EventBinding) {
  const value: unknown = JSON.parse(encodeJson(input, MAX_ATTEMPT_OBSERVATION_BYTES));
  // Reuse the existing full snapshot capture/identity contract, including result bytes.
  return mergeAttemptObservation({expected: binding.key.attempt, previous: null, incoming: value}).snapshot;
}

export function observationValue(input: unknown, binding: EventBinding): void {
  const copy: unknown = JSON.parse(encodeJson(input, 1_048_576));
  const value = fields(copy, ['run', 'snapshot', 'executionCharged', 'runChanged']);
  const result = validateApi('Run', value.run); requireValue(result.ok);
  const run = result.value;
  requireValue(run.id === binding.key.runId && run.activeAttemptId === binding.key.attempt.attemptId
    && run.scope.organizationId === binding.key.attempt.organizationId
    && run.scope.workspaceId === binding.key.attempt.workspaceId);
  boundSnapshot(value.snapshot, binding);
  requireValue(typeof value.executionCharged === 'boolean' && typeof value.runChanged === 'boolean');
}

function terminal(receipt: Record<string, unknown>, run: Run): void {
  requireValue(receipt.state === 'cancelled' ? run.cancellationRequested && receipt.reason === 'cancelled'
    : receipt.state === 'errored' && receipt.reason !== null && receipt.reason !== 'cancelled');
}
