import { createHash } from 'node:crypto';
import { encodeJson, validate } from '@beetle/contracts';
import { captureSourceChunkRequest, verifySourceChunk, verifySourceEnvelope,
  SOURCE_CHUNK_REQUEST_BYTES, SOURCE_ENVELOPE_BYTES, SOURCE_CHUNK_BYTES } from '@beetle/contracts/output-source';
import type { SourceChunkRequest } from '@beetle/contracts/output-source';
import type { FastifyReply } from 'fastify';
import type { GenerationKey } from '../journal/index.js';
import { bodyMatches } from './auth.js';
import { AgentHttpError } from './types.js';

export function chunkRequest(input: unknown): SourceChunkRequest {
  try { return captureSourceChunkRequest(JSON.parse(encodeJson(input, SOURCE_CHUNK_REQUEST_BYTES))); }
  catch { throw new AgentHttpError(400, 'invalid_protocol'); }
}
export function sendSource(reply: FastifyReply, input: unknown, expected: GenerationKey, authority: string): void {
  try {
    const text = encodeJson(input, SOURCE_ENVELOPE_BYTES);
    const value = verifySourceEnvelope(JSON.parse(text), data => createHash('sha256').update(data).digest('hex'));
    bodyMatches(expected, expected.attemptId, value.manifest.binding);
    if (value.manifest.binding.journalAuthority !== authority) throw new Error();
    reply.code(200).type('application/json; charset=utf-8').serializer(() => text).send(value);
  } catch { throw new AgentHttpError(500, 'invalid_protocol'); }
}
export function sendChunk(reply: FastifyReply, input: unknown, request: SourceChunkRequest): void {
  try {
    const text = encodeJson(input, SOURCE_CHUNK_BYTES); const captured: unknown = JSON.parse(text);
    const checked = validate('SourceChunk', captured); if (!checked.ok) throw new Error();
    const value = verifySourceChunk(checked.value, request, checked.value.totalBytes);
    reply.code(200).type('application/json; charset=utf-8').serializer(() => text).send(value);
  } catch { throw new AgentHttpError(500, 'invalid_protocol'); }
}
