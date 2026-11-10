import { RUNNER_MAXIMUM_OFFER_BYTES, encodeJson, validate } from '@beetle/contracts';
import type { Offer } from '@beetle/contracts';
import { CatalogError } from '../catalog/index.js';

export function structuralOffer(input: unknown): Offer {
  try {
    const checked = validate('Offer', JSON.parse(encodeJson(input, RUNNER_MAXIMUM_OFFER_BYTES)) as unknown);
    if (checked.ok) return checked.value;
  } catch { /* Keep boundary diagnostics independent of private input. */ }
  throw new CatalogError('invalid_offer');
}
