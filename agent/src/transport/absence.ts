import { performance } from 'node:perf_hooks';
import { encodeJson } from '@beetle/contracts';
import { captureOutputAbsence, OUTPUT_ABSENCE_BYTES } from '@beetle/contracts/output-source';
import type { AbsenceIdentity } from '@beetle/contracts/output-source';
import type { FastifyReply } from 'fastify';
import type { GenerationKey } from '../journal/index.js';
import type { Operation } from '../backends/docker/index.js';
import type { AgentHttpOptions } from './types.js';
import { AgentHttpError } from './types.js';
import { snapshotBody } from './json.js';

type Services = Pick<AgentHttpOptions, 'journal' | 'journalAuthority'> & {
  readonly absences: AgentHttpOptions['absences'];
};
function check(budget: Operation): void {
  if (budget.signal?.aborted || performance.now() >= budget.deadline) throw new AgentHttpError(503, 'execution_lost', 'transport');
}
function captureProof(input: unknown, expected?: AbsenceIdentity) {
  try { return captureOutputAbsence(input, expected); }
  catch { throw new AgentHttpError(500, 'invalid_protocol'); }
}
/** Capture the bounded stored carrier before observing any of its binding fields. */
export async function readAbsence(services: Services, scope: GenerationKey, budget: Operation) {
  if (!services.absences) throw new AgentHttpError(503, 'execution_lost', 'transport');
  check(budget);
  const input = await services.absences.readOutputAbsence(scope); check(budget);
  if (input === null) return null;
  const value = captureProof(input);
  const snapshot = snapshotBody(await services.journal.get(scope), scope); check(budget);
  return captureProof(value, { ...scope, generation: 1, intentDigest: snapshot.intentDigest,
    journalAuthority: services.journalAuthority });
}
export function sendAbsence(reply: FastifyReply, value: NonNullable<Awaited<ReturnType<typeof readAbsence>>>): void {
  const text = encodeJson(value, OUTPUT_ABSENCE_BYTES);
  reply.code(200).type('application/json; charset=utf-8').serializer(() => text).send(value);
}
