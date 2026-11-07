import type { ProtocolName, ValidationResult } from './validate.js';
import { validatePrimitive } from './validate.js';
import type { ProtocolTypes } from './generated/types.js';
import type { ClientResult, RunnerTransport } from './http.js';

interface Operation<N extends ProtocolName> {
  method: string; path: string; response: N; successStatus: number; request?: ProtocolName; cursor?: boolean;
}
interface Input { attemptId?: unknown; after?: unknown; body?: unknown; signal?: AbortSignal | undefined }

function operationPath(operation: Operation<ProtocolName>, input: Input): ValidationResult<string> {
  let path = operation.path;
  if (path.includes('{attemptId}')) {
    const id = validatePrimitive('uuid', input.attemptId);
    if (!id.ok) return id;
    path = path.replace('{attemptId}', encodeURIComponent(id.value));
  }
  if (operation.cursor) {
    const cursor = validatePrimitive('cursor', input.after);
    if (!cursor.ok) return cursor;
    path += `?after=${encodeURIComponent(cursor.value)}`;
  }
  return { ok: true, value: path };
}

/** Parameter validation precedes encoding, network calls and body observation. */
export async function invokeRunner<N extends ProtocolName>(transport: RunnerTransport, operation: Operation<N>, input: Input): Promise<ClientResult<ProtocolTypes[N]>> {
  const path = operationPath(operation, input);
  if (!path.ok) return { ok: false, error: { kind: 'request', issues: path.issues } };
  return transport.json({ ...operation, path: path.value, body: input.body, signal: input.signal });
}
