import { SupervisorError } from '../supervisor/index.js';

/** Private provenance for a nonissued controller Offer read. */
export class CollectionReadBusy extends Error {}
export function busyActor(error: unknown): boolean {
  return error instanceof SupervisorError && error.code === 'journal_busy';
}
