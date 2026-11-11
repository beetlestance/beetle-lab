import type { Offer } from '@beetle/contracts';
import { JournalError } from '../journal/index.js';
import { validateReservation } from './identity.js';
import type { Reservation } from '../admission/index.js';
import type { JournalPort, LaunchInput, OfferAuthority } from './types.js';

/** Private provenance: only a concrete, nonissued readOffer refusal creates it. */
export class ReadOfferBusy extends Error {}
export async function captureAuthority(journal: JournalPort, input: LaunchInput,
  current: Reservation, validated?: (offer: Offer) => void): Promise<OfferAuthority> {
  let offer;
  try { offer = await journal.readOffer(input.key); }
  catch (error) {
    if (error instanceof JournalError && error.code === 'queue_full') throw new ReadOfferBusy();
    throw error;
  }
  const authority: OfferAuthority = Object.freeze({ organizationId: offer.organizationId,
    workspaceId: offer.workspaceId, attemptId: offer.attemptId, intentDigest: offer.intentDigest,
    engine: Object.freeze({ id: offer.engine.id, imageDigest: offer.engine.imageDigest, configVersion: offer.engine.configVersion }),
    budget: Object.freeze({ cpuMillis: offer.budget.cpuMillis, memoryBytes: offer.budget.memoryBytes,
      pids: offer.budget.pids, timeoutMs: offer.budget.timeoutMs, outputBytes: offer.budget.outputBytes }) });
  validateReservation(input, current, authority);
  validated?.(offer);
  return authority;
}
