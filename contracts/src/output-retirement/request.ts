import { encodeJson, encodeCanonicalJson } from '../json.js';
import { validate } from '../validate.js';
import type { OutputRetirementRequest } from '../generated/types.js';
import type { Owned } from '../output-source/index.js';
import type { ResultDigest } from '../result-seal.js';
export const OUTPUT_RETIREMENT_REQUEST_BYTES = 3072;
export const OUTPUT_RETIREMENT_PREFIX = 'beetle-lab.output-retirement.v1\n';
export type RetirementRequest = Owned<OutputRetirementRequest>;
export class OutputRetirementValueError extends Error {
  constructor() { super('Invalid output retirement value'); }
}
/** Closed metadata only: no path, native observation, producer drain or cleanup authority. */
export function captureOutputRetirementRequest(input: unknown): RetirementRequest {
  const copy: unknown = JSON.parse(encodeJson(input, OUTPUT_RETIREMENT_REQUEST_BYTES));
  const result = validate('OutputRetirementRequest', copy);
  if (!result.ok) throw new OutputRetirementValueError();
  Object.freeze(result.value.closure); return Object.freeze(result.value);
}
export function outputRetirementDigest(input: unknown, digest: ResultDigest): string {
  const request = captureOutputRetirementRequest(input);
  const hash = digest(OUTPUT_RETIREMENT_PREFIX + encodeCanonicalJson(request, OUTPUT_RETIREMENT_REQUEST_BYTES));
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new OutputRetirementValueError(); return hash;
}
