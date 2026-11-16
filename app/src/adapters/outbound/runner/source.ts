import { encodeJson } from '@beetle/contracts';
import type { ClientResult } from '@beetle/contracts';
import { captureSourceChunkRequest, SOURCE_CHUNK_REQUEST_BYTES, SOURCE_CHUNK_BYTES, SOURCE_ENVELOPE_BYTES } from '@beetle/contracts/output-source';
import type { Owned, SourceChunkRequest } from '@beetle/contracts/output-source';
import type { RunnerOutputClient } from '../../../ports/output-source.js';
import type { RunnerOutputAbsenceClient } from '../../../ports/output-absence.js';
import type { RunnerAttemptIdentity } from '../../../ports/runner.js';
import { scopeHeaders } from './identity.js';
import { nativeCall } from './native.js';
import { chunkReply, envelopeReply } from './source-replies.js';
import type { Connection } from './transport.js';
import { absence } from './absence.js';

function requestBody(input: SourceChunkRequest, artifactBytes: number): ClientResult<{ request: Owned<SourceChunkRequest>; body: string }> {
  try {
    // Apply the byte cap before schema/semantic capture; never observe getters.
    const body = encodeJson(input, SOURCE_CHUNK_REQUEST_BYTES);
    const request = captureSourceChunkRequest(JSON.parse(body) as unknown);
    if (!Number.isSafeInteger(artifactBytes) || artifactBytes < 0 || request.offset > artifactBytes) throw new Error();
    return { ok: true, value: { request, body } };
  } catch { return { ok: false, error: { kind: 'request' } }; }
}

function read(connection: Connection, identity: RunnerAttemptIdentity, signal: AbortSignal, body?: string) {
  const chunk = body !== undefined;
  return nativeCall({ origin: connection.origin, method: chunk ? 'POST' : 'GET',
    path: `/runner/v1/attempts/${encodeURIComponent(identity.attemptId)}/source${chunk ? '/chunk' : ''}`,
    headers: { authorization: `Bearer ${connection.token}`, ...scopeHeaders(identity) }, body, signal,
    responseBytes: chunk ? SOURCE_CHUNK_BYTES : SOURCE_ENVELOPE_BYTES }, connection.io);
}

/** An immutable facade on the same connection, credits and native-close owner. */
export function createSourceClient(connection: Connection, identity: RunnerAttemptIdentity): RunnerOutputClient & RunnerOutputAbsenceClient {
  return Object.freeze({
    absence: signal => absence(connection, identity, signal),
    source: signal => connection.credits.run('source', signal, async original => {
      if (identity.generation !== 1) return { ok: false, error: { kind: 'request' } };
      return envelopeReply(await read(connection, identity, original.signal), identity);
    }),
    sourceChunk: (input, artifactBytes, signal) => connection.credits.run('source', signal, async original => {
      if (identity.generation !== 1) return { ok: false, error: { kind: 'request' } };
      const captured = requestBody(input, artifactBytes);
      if (!captured.ok) return captured;
      const response = await read(connection, identity, original.signal, captured.value.body);
      return chunkReply(response, identity, captured.value.request, artifactBytes);
    }),
  } satisfies RunnerOutputClient & RunnerOutputAbsenceClient);
}
