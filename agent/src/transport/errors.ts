import type { FastifyError, FastifyReply } from 'fastify';
import type { ProtocolError } from '@beetle/contracts';
import { JournalError } from '../journal/index.js';
import { CatalogError } from '../catalog/index.js';
import { InstallationError } from '../installation/index.js';
import { OutputTransferError } from '../output-transfer/index.js';
import { AgentHttpError } from './types.js';
import type { HttpScope } from './types.js';
import { sendJson } from './json.js';
function journal(error: JournalError): AgentHttpError {
  if (error.code === 'not_found') return new AgentHttpError(404, 'attempt_not_found');
  if (['conflict', 'stale_generation'].includes(error.code)) return new AgentHttpError(409, 'conflicting_digest');
  if (error.code === 'cursor_expired') return new AgentHttpError(409, 'cursor_expired', 'transport');
  if (['queue_full', 'quota_exceeded'].includes(error.code)) return new AgentHttpError(429, 'budget_unavailable', 'transport');
  if (error.code === 'invalid_input') return new AgentHttpError(400, 'invalid_config');
  return new AgentHttpError(503, 'execution_lost', 'transport');
}
function transfer(error: OutputTransferError): AgentHttpError {
  const values = {
    pending: new AgentHttpError(409, 'source_pending', 'transport'),
    unavailable: new AgentHttpError(409, 'source_unavailable'),
    conflict: new AgentHttpError(409, 'conflicting_digest'),
    invalid_input: new AgentHttpError(400, 'invalid_protocol'),
    busy: new AgentHttpError(429, 'budget_unavailable', 'transport'),
    interrupted: new AgentHttpError(503, 'execution_lost', 'transport'),
  };
  return values[error.code];
}
function parserError(error: unknown, source: boolean): AgentHttpError | undefined {
  const code = (error as Partial<FastifyError> | null)?.code;
  const reason = source ? 'invalid_protocol' : 'invalid_config';
  if (code === 'FST_ERR_CTP_BODY_TOO_LARGE') return new AgentHttpError(413, reason);
  if (typeof code === 'string' && code.startsWith('FST_ERR_CTP_')) return new AgentHttpError(400, reason);
  return undefined;
}
function classify(error: unknown, source: boolean): AgentHttpError {
  if (error instanceof AgentHttpError) return error;
  if (error instanceof JournalError) return journal(error);
  if (error instanceof OutputTransferError) return transfer(error);
  if (error instanceof CatalogError) return new AgentHttpError(422,
    error.reason === 'unapproved_engine' ? 'unsupported_capability' : 'invalid_config');
  if (error instanceof InstallationError) return new AgentHttpError(503, 'setup_failed', 'transport');
  return parserError(error, source) ?? new AgentHttpError(500, 'invalid_protocol');
}
export function sendError(reply: FastifyReply, error: unknown, scope: HttpScope | undefined, source = false): void {
  const failure = classify(error, source);
  // Authentication/invalid-scope failures have no authoritative namespace. Do not invent IDs.
  if (!scope) { reply.code(failure.status).send(); return; }
  const response: ProtocolError = { protocolVersion: '1.0', organizationId: scope.organizationId,
    workspaceId: scope.workspaceId, ...(scope.attemptId ? { attemptId: scope.attemptId } : {}), reason: failure.reason, retry: failure.retry, issues: [] };
  if (error instanceof JournalError && error.code === 'cursor_expired' && error.recovery) {
    response.cursorRecovery = { retainedStartSeq: error.recovery.retainedStartSeq, snapshotAvailable: true };
  }
  sendJson(reply, failure.status, 'ProtocolError', response);
}
