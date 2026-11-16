import { captureOutputAbsence, OUTPUT_ABSENCE_BYTES } from '@beetle/contracts/output-source';
import type { Owned, OutputAbsence } from '@beetle/contracts/output-source';
import type { ClientResult } from '@beetle/contracts';
import type { RunnerAttemptIdentity } from '../../../ports/runner.js';
import { scopeHeaders } from './identity.js';
import { nativeCall } from './native.js';
import { errorReply } from './source-replies.js';
import type { Connection } from './transport.js';

/** One read on the original installation connection; credits retain all native closes. */
export function absence(connection: Connection, identity: RunnerAttemptIdentity,
  signal?: AbortSignal): Promise<ClientResult<Owned<OutputAbsence>>> {
  return connection.credits.run<Owned<OutputAbsence>>('source', signal, async original => {
    if (identity.generation !== 1) return { ok: false, error: { kind: 'request' } };
    const response = await nativeCall({ origin: connection.origin, method: 'GET',
      path: `/runner/v1/attempts/${encodeURIComponent(identity.attemptId)}/source/absence`,
      headers: { authorization: `Bearer ${connection.token}`, ...scopeHeaders(identity) }, body: undefined,
      signal: original.signal, responseBytes: OUTPUT_ABSENCE_BYTES }, connection.io);
    if (!response.ok) return { ok: false, error: { kind: response.kind } };
    if (response.status !== 200) return errorReply(response, identity);
    try { return { ok: true, value: captureOutputAbsence(response.value, { ...identity, generation: 1 }) }; }
    catch { return { ok: false, error: { kind: 'response', status: response.status } }; }
  });
}
