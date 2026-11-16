import { createHash } from 'node:crypto';
import { captureStandaloneExportAssignment, RUNNER_MAXIMUM_OFFER_BYTES, encodeJson, validate } from '@beetle/contracts';
import type { Offer, StandaloneExportAssignment } from '@beetle/contracts';
import { CatalogError } from '../catalog/index.js';

export function structuralOffer(input: unknown): Offer {
  try {
    const checked = validate('Offer', JSON.parse(encodeJson(input, RUNNER_MAXIMUM_OFFER_BYTES)) as unknown);
    if (checked.ok && !checked.value.requiredCapabilities.includes('standalone-export-v1')) return checked.value;
  } catch { /* Keep boundary diagnostics independent of private input. */ }
  throw new CatalogError('invalid_offer');
}

export function structuralExport(input:unknown): StandaloneExportAssignment {
  try {return captureStandaloneExportAssignment(input,text=>createHash('sha256').update(text).digest('hex'));}
  catch {throw new CatalogError('invalid_offer');}
}
