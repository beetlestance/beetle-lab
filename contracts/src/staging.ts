import { encodeJson } from './json.js';
import { RUNNER_MAXIMUM_OFFER_BYTES } from './limits.js';
import type { Offer } from './generated/types.js';

/** Private installation policy, pinned in each candidate/reservation before I/O. */
export const stagingPolicy = Object.freeze({ version: 1 as const, offerBytes: RUNNER_MAXIMUM_OFFER_BYTES,
  manifestBytes: 65_536, metadataBytes: 65_536, secretBytes: 65_536, aggregateSecretBytes: 1_048_576 });
export interface StagingEstimate {
  policyVersion: 1;
  offerBytes: number;
  inputBytes: number;
  secretBytes: number;
  manifestBytes: number;
  metadataBytes: number;
  totalBytes: number;
}
function add(left: number, right: number): number {
  if (!Number.isSafeInteger(right) || right < 0 || right > Number.MAX_SAFE_INTEGER - left) {
    throw new Error('Invalid staging size');
  }
  return left + right;
}

/** Exact bytes prescribed for offer.json. No whitespace, trailing newline or secret resolution. */
export function serializeStagedOffer(offer: Offer): string {
  return encodeJson(offer, stagingPolicy.offerBytes);
}

/** Caller validates Offer first; this pure cost calculation performs no resolution or I/O. */
export function estimateStaging(offer: Offer): Readonly<StagingEstimate> {
  const offerBytes = new TextEncoder().encode(serializeStagedOffer(offer)).byteLength;
  const inputBytes = offer.inputs.reduce((total, input) => add(total, input.bytes), 0);
  const secretCount = offer.secretReferences?.length ?? 0;
  if (!Number.isSafeInteger(secretCount) || secretCount > 64) throw new Error('Invalid staging size');
  const secretBytes = Math.min(secretCount * stagingPolicy.secretBytes, stagingPolicy.aggregateSecretBytes);
  const { manifestBytes, metadataBytes } = stagingPolicy;
  const totalBytes = [offerBytes, secretBytes, manifestBytes, metadataBytes].reduce(add, inputBytes);
  return Object.freeze({ policyVersion: stagingPolicy.version, offerBytes, inputBytes,
    secretBytes, manifestBytes, metadataBytes, totalBytes });
}

/** Old unpublished queue records cannot authorize staging with an unaccounted policy. */
export function supportedStaging(estimate: StagingEstimate | undefined, chargedBytes: number): boolean {
  if (!estimate || estimate.policyVersion !== stagingPolicy.version) return false;
  const fixed = estimate.manifestBytes === stagingPolicy.manifestBytes && estimate.metadataBytes === stagingPolicy.metadataBytes;
  try {
    const total = [estimate.offerBytes, estimate.inputBytes, estimate.secretBytes,
      estimate.manifestBytes, estimate.metadataBytes].reduce(add, 0);
    return fixed && estimate.offerBytes <= stagingPolicy.offerBytes && estimate.secretBytes <= stagingPolicy.aggregateSecretBytes
      && total === estimate.totalBytes && chargedBytes === total;
  } catch { return false; }
}
