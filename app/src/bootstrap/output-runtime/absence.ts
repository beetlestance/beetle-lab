import { encodeCanonicalJson } from '@beetle/contracts';
import type { ClientResult } from '@beetle/contracts';
import { captureOutputAbsence } from '@beetle/contracts/output-source';
import type { Run } from '@beetle/contracts/api';
import type { OutputAbsenceFinalizeRequest, OutputAbsenceState } from '../../ports/output-absence.js';
import { getRun } from '../../application/runs/index.js';
import type { EventBinding } from '../../ports/events.js';
import type { OutputRuntimeOptions } from '../../ports/output-runtime.js';
import { OutputTransferError } from '../../ports/output-transfer.js';
import { absenceFinalization, absenceState, boundSnapshot, observationValue } from './absence-values.js';
import { fields, requireValue } from './validation.js';

export function remoteValue<T>(reply: ClientResult<T>): T {
  const ok = Object.getOwnPropertyDescriptor(reply, 'ok');
  requireValue(ok && 'value' in ok && typeof ok.value === 'boolean');
  fields(reply, ok.value ? ['ok', 'value'] : ['ok', 'error']);
  if (!reply.ok) throw new OutputTransferError('transport');
  return reply.value;
}
async function proof(options: OutputRuntimeOptions, binding: EventBinding, signal: AbortSignal) {
  const retained = await options.absences.read(binding);
  if (signal.aborted) return null;
  if (retained !== null) return absenceState(retained, binding);
  const identity = { ...binding.key.attempt, journalAuthority: binding.journalAuthority };
  const client = options.gateway.output(identity);
  requireValue(typeof client.absence === 'function');
  const reply = await client.absence(signal);
  if (signal.aborted) return null;
  const closure = captureOutputAbsence(remoteValue(reply), identity);
  const state = absenceState(await options.absences.adopt({ binding, closure }), binding);
  requireValue(encodeCanonicalJson(state.closure, 2048) === encodeCanonicalJson(closure, 2048));
  return state;
}
export async function refreshOutputSnapshot(
  options: OutputRuntimeOptions,
  binding: EventBinding,
  signal: AbortSignal,
): Promise<void> {
  const client = options.gateway.attempt({ ...binding.key.attempt, journalAuthority: binding.journalAuthority });
  requireValue(typeof client.snapshot === 'function');
  const reply = await client.snapshot(signal);
  if (signal.aborted) return;
  const snapshot = boundSnapshot(remoteValue(reply), binding);
  // Physical authority comes from the same bound authenticated gateway, not JSON.
  observationValue(
    await options.observations.observe({ key: binding.key, journalAuthority: binding.journalAuthority, snapshot }),
    binding,
  );
}
async function finalize(
  options: OutputRuntimeOptions,
  request: OutputAbsenceFinalizeRequest,
  state: OutputAbsenceState,
  run: Run,
): Promise<'execution' | 'history' | 'done'> {
  let reply;
  try {
    reply = await options.absences.finalize(request);
  } catch (error) {
    const code = error instanceof Error ? Object.getOwnPropertyDescriptor(error, 'code')?.value : undefined;
    if (code === 'conflict') return 'done';
    if (code === 'queue_full') throw new OutputTransferError('busy');
    throw error;
  }
  return absenceFinalization(reply, request, state, run);
}
/** Runs only after the initial source_absent transfer and both originals retire. */
export async function handoffAbsence(
  options: OutputRuntimeOptions,
  binding: EventBinding,
  signal: AbortSignal,
): Promise<void> {
  const state = await proof(options, binding, signal);
  if (signal.aborted || !state) return;
  const identity = binding.key.attempt;
  const runKey = {
    id: binding.key.runId,
    scope: { kind: 'workspace' as const, organizationId: identity.organizationId, workspaceId: identity.workspaceId },
  };
  let run = await getRun(runKey, options.runs);
  requireValue(run.activeAttemptId === identity.attemptId);
  if (signal.aborted) return;
  const request = finalizationRequest(options, state, run.version);
  const result = await finalizeWithHistory(options, request, state, run, signal);
  if (signal.aborted || result !== 'execution') return;
  await refreshOutputSnapshot(options, binding, signal);
  if (signal.aborted) return;
  run = await getRun(runKey, options.runs);
  requireValue(run.activeAttemptId === identity.attemptId);
  if (signal.aborted) return;
  await finalizeWithHistory(options, { ...request, expectedRunVersion: run.version }, state, run, signal);
}

function finalizationRequest(
  options: OutputRuntimeOptions,
  state: OutputAbsenceState,
  expectedRunVersion: number,
): OutputAbsenceFinalizeRequest {
  const { binding, proofDigest, closure } = state;
  const request = { binding, proofDigest, expectedRunVersion };
  if (
    closure.admission.state !== 'released' ||
    closure.admission.disposition !== 'settled' ||
    closure.finalAgentSeq <= 0
  )
    return request;
  const client = options.gateway.output({ ...binding.key.attempt, journalAuthority: binding.journalAuthority });
  return client.stoppedHistory ? { ...request, stoppedHistory: 'fetch' } : request;
}

async function finalizeWithHistory(
  options: OutputRuntimeOptions,
  request: OutputAbsenceFinalizeRequest,
  state: OutputAbsenceState,
  run: Run,
  signal: AbortSignal,
): Promise<'execution' | 'done'> {
  const result = await finalize(options, request, state, run);
  if (result !== 'history') return result;
  if (signal.aborted) return 'done';
  const client = options.gateway.output({
    ...request.binding.key.attempt,
    journalAuthority: request.binding.journalAuthority,
  });
  const read = client.stoppedHistory;
  requireValue(typeof read === 'function' && request.stoppedHistory === 'fetch');
  const response = await read.call(client, signal);
  if (signal.aborted) return 'done';
  const { absence, observation } = remoteValue(response);
  requireValue(encodeCanonicalJson(state.closure, 2048) === encodeCanonicalJson(absence, 2048));
  const retried = await finalize(
    options,
    {
      binding: request.binding,
      proofDigest: request.proofDigest,
      expectedRunVersion: request.expectedRunVersion,
      ...(observation === null ? {} : { stoppedHistory: observation }),
    },
    state,
    run,
  );
  requireValue(retried !== 'history');
  return retried;
}
