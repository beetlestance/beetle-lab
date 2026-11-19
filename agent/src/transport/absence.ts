import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { encodeJson } from '@beetle/contracts';
import {
  captureOutputAbsence,
  encodeStoppedHistoryClosure,
  encodeStoppedDeliveryHistory,
  OUTPUT_ABSENCE_BYTES,
} from '@beetle/contracts/output-source';
import type { AbsenceIdentity } from '@beetle/contracts/output-source';
import type { FastifyReply } from 'fastify';
import type { GenerationKey } from '../journal/index.js';
import type { Operation } from '../backends/docker/index.js';
import type { AgentHttpOptions } from './types.js';
import { AgentHttpError } from './types.js';
import { snapshotBody } from './json.js';

type Services = Pick<AgentHttpOptions, 'journal' | 'journalAuthority'> & {
  readonly absences: AgentHttpOptions['absences'];
  readonly deliveries: AgentHttpOptions['deliveries'];
};
function check(budget: Operation): void {
  if (budget.signal?.aborted || performance.now() >= budget.deadline)
    throw new AgentHttpError(503, 'execution_lost', 'transport');
}
function captureProof(input: unknown, expected?: AbsenceIdentity) {
  try {
    return captureOutputAbsence(input, expected);
  } catch {
    throw new AgentHttpError(500, 'invalid_protocol');
  }
}
/** Capture the bounded stored carrier before observing any of its binding fields. */
export async function readAbsence(services: Services, scope: GenerationKey, budget: Operation) {
  if (!services.absences) throw new AgentHttpError(503, 'execution_lost', 'transport');
  check(budget);
  const input = await services.absences.readOutputAbsence(scope);
  check(budget);
  if (input === null) return null;
  const value = captureProof(input);
  const snapshot = snapshotBody(await services.journal.get(scope), scope);
  check(budget);
  return captureProof(value, {
    ...scope,
    generation: 1,
    intentDigest: snapshot.intentDigest,
    journalAuthority: services.journalAuthority,
  });
}
export function sendAbsence(reply: FastifyReply, value: NonNullable<Awaited<ReturnType<typeof readAbsence>>>): void {
  const text = encodeJson(value, OUTPUT_ABSENCE_BYTES);
  reply
    .code(200)
    .type('application/json; charset=utf-8')
    .serializer(() => text)
    .send(value);
}

function requireStoppedObservation(
  snapshot: ReturnType<typeof snapshotBody>,
  finalAgentSeq: number,
  available: boolean,
): void {
  if (finalAgentSeq !== snapshot.lastSeq) throw new AgentHttpError(500, 'invalid_protocol');
  if (!available) return;
  if (
    snapshot.state !== 'exited' ||
    !snapshot.exitEvidence ||
    snapshot.admission?.state !== 'released' ||
    snapshot.admission.disposition !== 'settled'
  )
    throw new AgentHttpError(500, 'invalid_protocol');
}

const hash = (text: string) => createHash('sha256').update(text).digest('hex');

async function readClosure(services: Services, scope: GenerationKey, kind: 'absence' | 'delivery') {
  if (kind === 'absence' && services.absences?.readStoppedHistoryClosure)
    return services.absences.readStoppedHistoryClosure(scope);
  if (kind === 'delivery' && services.deliveries) return services.deliveries.readStoppedDeliveryClosure(scope);
  throw new AgentHttpError(503, 'execution_lost', 'transport');
}

export async function readStoppedClosure(
  services: Services,
  scope: GenerationKey,
  budget: Operation,
  kind: 'absence' | 'delivery',
): Promise<string> {
  check(budget);
  const record = await readClosure(services, scope, kind);
  check(budget);
  const snapshot = snapshotBody(await services.journal.get(scope), scope);
  check(budget);
  if (record === null) {
    if (kind === 'delivery' && services.absences && (await readAbsence(services, scope, budget)) !== null)
      throw new AgentHttpError(409, 'source_absent');
    throw new AgentHttpError(409, 'source_pending', 'transport');
  }
  const expected = {
    ...scope,
    generation: 1 as const,
    intentDigest: snapshot.intentDigest,
    journalAuthority: services.journalAuthority,
  };
  const sequence = 'delivery' in record ? record.delivery.finalAgentSeq : record.absence.finalAgentSeq;
  requireStoppedObservation(snapshot, sequence, record.observation !== null);
  try {
    const json =
      'delivery' in record
        ? encodeStoppedDeliveryHistory(record, expected, hash)
        : encodeStoppedHistoryClosure(record, expected, hash);
    check(budget);
    return json;
  } catch (error) {
    if (error instanceof AgentHttpError) throw error;
    throw new AgentHttpError(500, 'invalid_protocol');
  }
}
