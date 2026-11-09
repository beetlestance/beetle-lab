import { RUNNER_MAXIMUM_OFFER_BYTES, encodeCanonicalJson, encodeJson, validate } from '@beetle/contracts';
import type { Offer } from '@beetle/contracts';
import { JournalError } from '../journal/index.js';
import { CatalogError } from '../catalog/index.js';
import type { ValidationIdentity } from '../admission/index.js';
import type { InstallationOptions } from './types.js';
interface EnqueueContext { readonly options: InstallationOptions; now(): number; open(): void }
import type { OfferAcceptance } from './types.js';
import { InstallationError } from './types.js';
export async function enqueue(manager: EnqueueContext, input: unknown): Promise<OfferAcceptance> {
  manager.open();
  const checked = structuralOffer(input);
  const replay = await acceptedReplay(manager, checked); manager.open();
  if (replay) return replay;
  const preflight = manager.options.catalog.preflight(checked); manager.open();
  const offer = JSON.parse(encodeJson(preflight.offer, RUNNER_MAXIMUM_OFFER_BYTES)) as Offer;
  const validation = JSON.parse(encodeJson(preflight.validation, 4096)) as ValidationIdentity;
  const now = manager.now(); manager.open();
  const value = await manager.options.journal.admission({ kind: 'offer', offer, validation, now });
  if ('status' in value || ('kind' in value && value.kind === 'defer' && value.reason === 'queued')) {
    return { accepted: true, snapshot: await manager.options.journal.get({ attemptId: offer.attemptId, organizationId: offer.organizationId, workspaceId: offer.workspaceId }) };
  }
  if ('kind' in value && value.kind !== 'admit') return { accepted: false, decision: value };
  throw new InstallationError('journal');
}

function structuralOffer(input: unknown): Offer {
  try {
    const checked = validate('Offer', JSON.parse(encodeJson(input, RUNNER_MAXIMUM_OFFER_BYTES)) as unknown);
    if (checked.ok) return checked.value;
  } catch { /* Keep boundary diagnostics independent of private input. */ }
  throw new CatalogError('invalid_offer');
}
async function acceptedReplay(manager: EnqueueContext, offer: Offer): Promise<OfferAcceptance | null> {
  const key = { attemptId: offer.attemptId, organizationId: offer.organizationId, workspaceId: offer.workspaceId };
  let accepted: Offer;
  try { accepted = await manager.options.journal.readOffer(key); }
  catch (error) {
    if (error instanceof JournalError && error.code === 'not_found') return null;
    throw error;
  }
  manager.open();
  if (encodeCanonicalJson(accepted, RUNNER_MAXIMUM_OFFER_BYTES) !== encodeCanonicalJson(offer, RUNNER_MAXIMUM_OFFER_BYTES)) {
    throw new JournalError('conflict');
  }
  return { accepted: true, snapshot: await manager.options.journal.get(key) };
}
