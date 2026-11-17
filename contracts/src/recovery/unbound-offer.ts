import { createRunnerRegistry } from '../validator-registry.js';
import { schema as offerSchema } from '../generated/offer.js';
import { encodeJson } from '../json.js';
import { RUNNER_MAXIMUM_CONFIG_BYTES } from '../limits.js';

let check: ((input: unknown) => boolean) | undefined;
function validator() {
  const { ajv } = createRunnerRegistry();
  return ajv.compile({
    ...offerSchema,
    $id: 'https://beetle-lab.dev/internal/unbound-stored-offer',
    required: offerSchema.required.filter((name) => name !== 'installedIdentity'),
  });
}
/** Read-only quarantine recognition. Never returns an executable Offer or adds a binding. */
export function isUnboundStoredOffer(input: unknown): input is Record<string, unknown> {
  if (!input || typeof input !== 'object' || Object.hasOwn(input, 'installedIdentity')) return false;
  check ??= validator();
  if (!check(input)) return false;
  try {
    encodeJson((input as Record<string, unknown>).config, RUNNER_MAXIMUM_CONFIG_BYTES);
    return true;
  } catch {
    return false;
  }
}
