import { LIVE_HISTORY_BYTES } from '@beetle/contracts/api';
import { captureOutputAbsence } from '@beetle/contracts/output-source';
import type { OutputAbsence, Owned } from '@beetle/contracts/output-source';
import { captureStoppedObservation } from './stopped-history-value.js';
import type { StoppedObservation } from './stopped-history-value.js';
import type { Scope } from '../admission/index.js';

export const OUTPUT_ABSENCE_ROW_ALLOWANCE = 256;
/** Trusted caller first retires actual native producers. The worker derives all
 * facts and the stream end; no HTTP/wrapper route can invoke close.
 */
export interface StoppedHistoryClosure {
  readonly absence: Owned<OutputAbsence>;
  readonly observation: StoppedObservation | null;
}

export interface JournalOutputAbsence {
  closeOutputAbsence(key: Scope, stoppedHistory?: string): Promise<Owned<OutputAbsence> | null>;
  readOutputAbsence(key: Scope): Promise<Owned<OutputAbsence> | null>;
}
export type OutputAbsenceOperation =
  | { readonly kind: 'outputAbsenceClose'; readonly key: Readonly<Scope>; readonly stoppedHistory?: string }
  | { readonly kind: 'outputAbsenceRead' | 'outputStoppedHistoryRead'; readonly key: Readonly<Scope> };

export function absenceCommand(
  kind: OutputAbsenceOperation['kind'],
  key: Scope,
  stoppedHistory: unknown,
): OutputAbsenceOperation {
  if (stoppedHistory === undefined) return { kind, key };
  if (
    kind !== 'outputAbsenceClose' ||
    typeof stoppedHistory !== 'string' ||
    stoppedHistory.length > LIVE_HISTORY_BYTES ||
    Buffer.byteLength(stoppedHistory) > LIVE_HISTORY_BYTES
  )
    throw new Error('Invalid stopped history submission');
  return { kind, key, stoppedHistory };
}

export function absenceReply(key: Scope, input: unknown): Owned<OutputAbsence> | null {
  if (input === null) return null;
  const proof = captureOutputAbsence(input);
  for (const field of ['organizationId', 'workspaceId', 'attemptId', 'generation'] as const) {
    if (proof[field] !== key[field]) throw new Error('Unexpected absence scope');
  }
  return proof;
}

function stoppedObservationReply(key: Scope, input: unknown): StoppedObservation {
  const reply = input as Partial<StoppedObservation>;
  const result = captureStoppedObservation(key, reply.json);
  if (result.digest !== reply.digest || result.bytes !== reply.bytes)
    throw new Error('Unexpected stopped history reply');
  return result;
}

export function stoppedHistoryReply(key: Scope, input: unknown): StoppedHistoryClosure {
  const reply = input as Partial<StoppedHistoryClosure>;
  const absence = absenceReply(key, reply.absence);
  if (!absence) throw new Error('Missing stopped history closure');
  return { absence, observation: reply.observation === null ? null : stoppedObservationReply(key, reply.observation) };
}
