import { createHash } from 'node:crypto';
import type { ClientResult, ProtocolError } from '@beetle/contracts';
import { verifySourceChunk, verifySourceEnvelope } from '@beetle/contracts/output-source';
import type { Owned, SourceChunk, SourceChunkRequest, SourceEnvelope } from '@beetle/contracts/output-source';
import type { RunnerAttemptIdentity } from '../../../ports/runner.js';
import type { NativeResult } from './native.js';
import { protocolReply } from './transport.js';

function sourceDisposition(error: ProtocolError, status: number): boolean {
  switch (error.reason) {
    case 'source_pending': return status === 409 && error.retry === 'transport';
    case 'source_unavailable': return status === 409 && error.retry === 'never';
    default: return true;
  }
}

function errorReply(response: Extract<NativeResult, { ok: true }>, identity: RunnerAttemptIdentity): ClientResult<never> {
  const refused: ClientResult<never> = { ok: false, error: { kind: 'response', status: response.status } };
  if (response.status < 400 || response.status > 599) return refused;
  const reply = protocolReply(response, identity);
  if (reply.ok || reply.error.kind !== 'protocol') return reply;
  const error = reply.error.protocol;
  if (!error || error.attemptId !== identity.attemptId) return refused;
  if (!sourceDisposition(error, response.status)) return refused;
  return reply;
}

/** Shared codec matches the complete receipt; this binds its manifest to the original. */
export function envelopeReply(response: NativeResult, identity: RunnerAttemptIdentity): ClientResult<Owned<SourceEnvelope>> {
  if (!response.ok) return { ok: false, error: { kind: response.kind } };
  if (response.status !== 200) return errorReply(response, identity);
  try {
    const value = verifySourceEnvelope(response.value, text => createHash('sha256').update(text, 'utf8').digest('hex'));
    const binding = value.manifest.binding;
    for (const field of ['organizationId', 'workspaceId', 'attemptId', 'generation', 'intentDigest', 'journalAuthority'] as const) {
      if (binding[field] !== identity[field]) throw new Error();
    }
    return { ok: true, value };
  } catch { return { ok: false, error: { kind: 'response', status: response.status } }; }
}

export function chunkReply(response: NativeResult, identity: RunnerAttemptIdentity,
  request: SourceChunkRequest, artifactBytes: number): ClientResult<Owned<SourceChunk>> {
  if (!response.ok) return { ok: false, error: { kind: response.kind } };
  if (response.status !== 200) return errorReply(response, identity);
  try { return { ok: true, value: verifySourceChunk(response.value, request, artifactBytes) }; }
  catch { return { ok: false, error: { kind: 'response', status: response.status } }; }
}
