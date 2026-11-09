import { RUNNER_MAXIMUM_OFFER_BYTES, encodeJson } from '@beetle/contracts';
import type { Offer } from '@beetle/contracts';
import type { ValidationIdentity } from '../admission/index.js';
import type { InstallationOptions } from './types.js';
interface EnqueueContext { readonly options: InstallationOptions; now(): number; open(): void }
import type { OfferAcceptance } from './types.js';
import { InstallationError } from './types.js';
export async function enqueue(manager: EnqueueContext, input: unknown): Promise<OfferAcceptance> {
  manager.open();
  const preflight = manager.options.catalog.preflight(input); manager.open();
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
