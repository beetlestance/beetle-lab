import { encodeCanonicalJson, validate } from '@beetle/contracts';
import type { AttemptSnapshot, EngineResult } from '@beetle/contracts';
import { verifyOutputManifest } from '@beetle/contracts/output-source';
import { sha256 } from '../input-values.js';
import { StorageError } from '../protocol.js';
export const HEADER_BYTES = 2048;
export const RESULT_BYTES = 65_536;
export const MANIFEST_BYTES = 73_728;
export function requirePayload(condition: unknown): asserts condition {
  if (!condition) throw new StorageError('unavailable');
}
export function splitSnapshot(snapshot: AttemptSnapshot) {
  const { result, ...header } = snapshot;
  return { header: encodeCanonicalJson(header, HEADER_BYTES), result: result === undefined ? null : encodeCanonicalJson(result, RESULT_BYTES) };
}
export function payloadResult(kind: unknown, json: unknown): EngineResult {
  requirePayload(typeof json === 'string');
  const value: unknown = JSON.parse(json);
  requirePayload(kind === 'result' || kind === 'manifest');
  const result = validate('EngineResult', kind === 'manifest' ? verifyOutputManifest(value, sha256).result : value); requirePayload(result.ok);
  return result.value;
}
