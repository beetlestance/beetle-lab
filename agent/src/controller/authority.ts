import type { Offer } from '@beetle/contracts';
import { JournalError } from '../journal/index.js';
import { CollectionReadBusy } from './launch-contention.js';
import type { ControllerJournal } from './types.js';

/** Collection needs no config, secret references, or other Offer payload. */
export interface CollectionAuthority {
  readonly engineId: Offer['engine']['id'];
  readonly outputBytes: number;
}
export async function collectionAuthority(journal: ControllerJournal,
  key: Parameters<ControllerJournal['readOffer']>[0]): Promise<CollectionAuthority> {
  let offer: Offer;
  try { offer = await journal.readOffer(key); }
  catch (error) {
    if (error instanceof JournalError && error.code === 'queue_full') throw new CollectionReadBusy();
    throw error;
  }
  return Object.freeze({ engineId: offer.engine.id, outputBytes: offer.budget.outputBytes });
}
