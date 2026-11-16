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

function remoteValue<T>(reply: ClientResult<T>): T {
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
  const identity = {...binding.key.attempt, journalAuthority: binding.journalAuthority};
  const client = options.gateway.output(identity);
  requireValue(typeof client.absence === 'function');
  const reply = await client.absence(signal);
  if (signal.aborted) return null;
  const closure = captureOutputAbsence(remoteValue(reply), identity);
  const state = absenceState(await options.absences.adopt({binding, closure}), binding);
  requireValue(encodeCanonicalJson(state.closure, 2048) === encodeCanonicalJson(closure, 2048));
  return state;
}
async function refresh(options: OutputRuntimeOptions, binding: EventBinding, signal: AbortSignal): Promise<void> {
  const client = options.gateway.attempt({...binding.key.attempt, journalAuthority: binding.journalAuthority});
  requireValue(typeof client.snapshot === 'function');
  const reply = await client.snapshot(signal);
  if (signal.aborted) return;
  const snapshot = boundSnapshot(remoteValue(reply), binding);
  // Physical authority comes from the same bound authenticated gateway, not JSON.
  observationValue(await options.observations.observe({key: binding.key, journalAuthority: binding.journalAuthority, snapshot}), binding);
}
async function finalize(options: OutputRuntimeOptions, request: OutputAbsenceFinalizeRequest,
  state: OutputAbsenceState, run: Run): Promise<'execution' | 'done'> {
  let reply;
  try { reply = await options.absences.finalize(request); }
  catch (error) {
    if (error instanceof Error && Object.getOwnPropertyDescriptor(error, 'code')?.value === 'conflict') return 'done';
    throw error;
  }
  return absenceFinalization(reply, request, state, run);
}
/** Runs only after the initial source_absent transfer and both originals retire. */
export async function handoffAbsence(options: OutputRuntimeOptions, binding: EventBinding,
  signal: AbortSignal): Promise<void> {
  const state = await proof(options, binding, signal);
  if (signal.aborted || !state) return;
  const identity = binding.key.attempt;
  const runKey = {id: binding.key.runId, scope: {kind: 'workspace' as const,
    organizationId: identity.organizationId, workspaceId: identity.workspaceId}};
  let run = await getRun(runKey, options.runs);
  requireValue(run.activeAttemptId === identity.attemptId);
  if (signal.aborted) return;
  let request = {binding, proofDigest: state.proofDigest, expectedRunVersion: run.version};
  const result = await finalize(options, request, state, run);
  if (signal.aborted || result !== 'execution') return;
  await refresh(options, binding, signal);
  if (signal.aborted) return;
  run = await getRun(runKey, options.runs);
  requireValue(run.activeAttemptId === identity.attemptId);
  if (signal.aborted) return;
  request = {...request, expectedRunVersion: run.version};
  await finalize(options, request, state, run);
}
