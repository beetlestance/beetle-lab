import { encodeJson, encodeCanonicalJson } from './json.js';
import { freezeJson } from './freeze.js';
export type ResultDigest = (utf8Preimage: string) => string;
export type ResultSeal<T> = {readonly ok: true; readonly value: T}
  | {readonly ok: false; readonly code: 'invalid_result' | 'digest_failed' | 'seal_mismatch'};
interface Sealed {seal: {sealedAt: string; sha256: string}}
interface Spec<T> {readonly prefix: string; readonly maximumBytes: number; readonly decode: (input: unknown) => T}
class SealFailure extends Error {
  constructor(readonly code: 'invalid_result' | 'digest_failed') {super('Result seal rejected');}
}
function digest(text: string, provider: ResultDigest): string {
  try {
    const value = provider(text);
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error();
    return value;
  } catch {throw new SealFailure('digest_failed');}
}
function failure(error: unknown): ResultSeal<never> {return {ok: false, code: error instanceof SealFailure ? error.code : 'invalid_result'};}
/** Private fixed-schema composition: decode validates and returns its supplied JSON.
 * Content integrity only; neither a seal nor its prefix authenticates a producer. */
export function createResultSealer<T extends Sealed>(spec: Spec<T>) {
  const snapshot = (input: unknown): T => spec.decode(JSON.parse(encodeJson(input, spec.maximumBytes)) as unknown);
  const preimage = (value: T): string => spec.prefix + encodeCanonicalJson({...value, seal: {sealedAt: value.seal.sealedAt}}, spec.maximumBytes);
  return Object.freeze({
    seal(body: unknown, sealedAt: string, provider: ResultDigest): ResultSeal<T> {
      try {
        const copy: unknown = JSON.parse(encodeJson(body, spec.maximumBytes));
        if (!copy || typeof copy !== 'object' || Array.isArray(copy) || Object.hasOwn(copy, 'seal')) throw new SealFailure('invalid_result');
        const result = snapshot({...copy, seal: {sealedAt, sha256: '0'.repeat(64)}});
        result.seal.sha256 = digest(preimage(result), provider); freezeJson(result); return {ok: true, value: result};
      } catch (error) {return failure(error);}
    },
    verify(input: unknown, provider: ResultDigest): ResultSeal<T> {
      try {
        const result = snapshot(input);
        if (digest(preimage(result), provider) !== result.seal.sha256) return {ok: false, code: 'seal_mismatch'};
        freezeJson(result); return {ok: true, value: result};
      } catch (error) {return failure(error);}
    },
    preimage(input: unknown): ResultSeal<string> {
      try {return {ok: true, value: preimage(snapshot(input))};} catch (error) {return failure(error);}
    },
  });
}
