import { storedJson, storedText } from './row-values.js';
import { RUNNER_MAXIMUM_OFFER_BYTES, validate } from '@beetle/contracts';
import type { Offer } from '@beetle/contracts';
import type { Row } from './attempt-row.js';
import { offerInput } from './input.js';
import { Failure } from './failure.js';
import { sqlTextColumn } from './sql-columns.js';
export const storedOfferColumns = [
  sqlTextColumn('offer_json', RUNNER_MAXIMUM_OFFER_BYTES),
  sqlTextColumn('canonical_json', RUNNER_MAXIMUM_OFFER_BYTES),
].join(',');
/** Validate the saved Offer itself, not just a newly submitted replay. */
export function captureStoredOffer(input: unknown, canonical: unknown, row: Row): Offer {
  const raw = storedJson(input, RUNNER_MAXIMUM_OFFER_BYTES);
  const savedCanonical = storedText(canonical, RUNNER_MAXIMUM_OFFER_BYTES);
  try {
    const parsed = validate('Offer', raw);
    if (!parsed.ok) throw new Failure('unavailable');
    const offer = parsed.value;
    if (
      offer.attemptId !== row.attempt_id ||
      offer.organizationId !== row.organization_id ||
      offer.workspaceId !== row.workspace_id ||
      offer.intentDigest !== row.intent_digest
    )
      throw new Failure('unavailable');
    if (offerInput(offer).canonical !== savedCanonical) throw new Failure('unavailable');
    return offer;
  } catch {
    throw new Failure('unavailable');
  }
}
