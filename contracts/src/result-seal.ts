import { encodeJson, encodeCanonicalJson } from './json.js';
import { validate } from './validate.js';
import type { EngineResult } from './generated/types.js';

export const resultSealPrefix = 'beetle-lab.engine-result.v1\n';
export type ResultDigest = (utf8Preimage: string) => string;
export type ResultSeal<T> = { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: 'invalid_result' | 'digest_failed' | 'seal_mismatch' };
class SealFailure extends Error {
  constructor(readonly code: 'invalid_result' | 'digest_failed') { super('Result seal rejected'); }
}
const maximumBytes = 1_048_576;
function snapshot(input: unknown): EngineResult {
  const copy: unknown = JSON.parse(encodeJson(input, maximumBytes));
  const checked = validate('EngineResult', copy);
  if (!checked.ok) throw new SealFailure('invalid_result');
  return checked.value;
}
function preimage(result: EngineResult): string {
  // sealedAt is covered. Only the digest's self-reference is excluded.
  return resultSealPrefix + encodeCanonicalJson({ ...result, seal: { sealedAt: result.seal.sealedAt } }, maximumBytes);
}
function digest(text: string, provider: ResultDigest): string {
  try {
    const value = provider(text);
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error();
    return value;
  } catch { throw new SealFailure('digest_failed'); }
}
function freeze(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  for (const child of Object.values(value)) freeze(child);
  Object.freeze(value);
}
function failure(error: unknown): ResultSeal<never> {
  return { ok: false, code: error instanceof SealFailure ? error.code : 'invalid_result' };
}
/** Content integrity only; this does not authenticate the engine, artifacts or outcome. */
export function sealEngineResult(body: unknown, sealedAt: string, provider: ResultDigest): ResultSeal<EngineResult> {
  try {
    const copy: unknown = JSON.parse(encodeJson(body, maximumBytes));
    if (!copy || typeof copy !== 'object' || Array.isArray(copy) || Object.hasOwn(copy, 'seal')) throw new SealFailure('invalid_result');
    const result = snapshot({ ...copy, seal: { sealedAt, sha256: '0'.repeat(64) } });
    result.seal.sha256 = digest(preimage(result), provider); freeze(result);
    return { ok: true, value: result };
  } catch (error) { return failure(error); }
}
/** Returns a private immutable snapshot after structural and content-integrity checks. */
export function verifyEngineResultSeal(input: unknown, provider: ResultDigest): ResultSeal<EngineResult> {
  try {
    const result = snapshot(input);
    if (digest(preimage(result), provider) !== result.seal.sha256) return { ok: false, code: 'seal_mismatch' };
    freeze(result); return { ok: true, value: result };
  } catch (error) { return failure(error); }
}
export function engineResultSealPreimage(input: unknown): ResultSeal<string> {
  try { return { ok: true, value: preimage(snapshot(input)) }; }
  catch (error) { return failure(error); }
}
