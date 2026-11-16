import { validate } from '../validate.js';
import type { SourceEnvelope } from '../generated/types.js';
import type { ResultDigest } from '../result-seal.js';
import { capture, canonical, checked, freeze, requireInput } from './capture.js';
import { verifyOutputManifest } from './manifest.js';
import { sameScope } from './shape.js';
import { SOURCE_ENVELOPE_BYTES } from './wire-limits.js';
import type { Owned } from './types.js';

/** Pure authenticated-content validation; establishes no file or producer custody. */
export function verifySourceEnvelope(input: unknown, digest: ResultDigest): Owned<SourceEnvelope> {
  return checked(() => {
    const captured = capture(input, SOURCE_ENVELOPE_BYTES);
    canonical(captured, SOURCE_ENVELOPE_BYTES);
    const result = validate('SourceEnvelope', captured); requireInput(result.ok);
    const value = result.value;
    const manifest = verifyOutputManifest(value.manifest, digest);
    const receipt = value.closure.receipt;
    requireInput(receipt.journalAuthority === manifest.binding.journalAuthority);
    sameScope(receipt.key, manifest.binding);
    requireInput(receipt.manifestDigest === manifest.manifestDigest);
    requireInput(receipt.sourceDigest === value.sourceDigest);
    return freeze({ ...value, manifest });
  });
}
