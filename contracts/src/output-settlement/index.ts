import { encodeCanonicalJson, encodeJson } from '../json.js';
import { validate } from '../validate.js';
import { captureOutputRetirementRequest, captureOutputRetirementReply } from '../output-retirement/index.js';
import type { OutputSettlementRequest, OutputSettlementReply } from '../generated/types.js';
import type { Owned } from '../output-source/index.js';
import type { ResultDigest } from '../result-seal.js';

export type SettlementRequest = Owned<OutputSettlementRequest>;
export type SettlementReply = Owned<OutputSettlementReply>;
export const SETTLEMENT_REQUEST_BYTES = 3584;
export const SETTLEMENT_REPLY_BYTES = 512;
export const AGENT_REPLAY_BYTES = 4096;
const prefix = 'beetle-lab.output-settlement.v1\n';
export class OutputSettlementValueError extends Error {
  constructor() { super('Invalid output settlement value'); }
}
function hash(value: string, digest: ResultDigest): string {
  const result = digest(value);
  if (!/^[a-f0-9]{64}$/.test(result)) throw new OutputSettlementValueError();
  return result;
}
/** Finite metadata only; a validated release instruction is not native cleanup proof. */
export function captureSettlementRequest(input: unknown): SettlementRequest {
  const checked = validate('OutputSettlementRequest', JSON.parse(encodeJson(input, SETTLEMENT_REQUEST_BYTES)) as unknown);
  if (!checked.ok) throw new OutputSettlementValueError();
  return Object.freeze({ ...checked.value, retirement: captureOutputRetirementRequest(checked.value.retirement) });
}
export function settlementRequestDigest(input: unknown, digest: ResultDigest): string {
  return hash(prefix + encodeCanonicalJson(captureSettlementRequest(input), SETTLEMENT_REQUEST_BYTES), digest);
}
export function cleanedReplyDigest(input: unknown, request: unknown, digest: ResultDigest): string {
  const reply = captureOutputRetirementReply(input, request, digest);
  if (reply.state !== 'cleaned') throw new OutputSettlementValueError();
  return hash(encodeCanonicalJson(reply, 4096), digest);
}
export function captureSettlementReply(input: unknown, expected: unknown, digest: ResultDigest): SettlementReply {
  const checked = validate('OutputSettlementReply', JSON.parse(encodeJson(input, SETTLEMENT_REPLY_BYTES)) as unknown);
  if (!checked.ok) throw new OutputSettlementValueError();
  const request = captureSettlementRequest(expected);
  if (checked.value.requestDigest !== settlementRequestDigest(request, digest)
    || checked.value.cleanupReplyDigest !== request.cleanupReplyDigest) throw new OutputSettlementValueError();
  return Object.freeze(checked.value);
}
