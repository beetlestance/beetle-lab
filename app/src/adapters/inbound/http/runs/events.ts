import type { RunEventPage } from '@beetle/contracts/api';
import type { RunEventsQuery, RunEventReader } from '../../../../ports/run-events.js';
import { getRunEvents } from '../../../../application/run-events/index.js';
import { ApiFault } from '../api-errors.js';

/** Missing finite-read capability is explicit, never fabricated pending success. */
export function getEvents(query: RunEventsQuery, reader: RunEventReader | undefined): Promise<RunEventPage> {
  if (!reader) throw new ApiFault('storage_unavailable');
  return getRunEvents(query, reader);
}
