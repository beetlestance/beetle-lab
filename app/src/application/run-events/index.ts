import { encodeJson } from '@beetle/contracts';
import { validateApi, runEventPageMatches } from '@beetle/contracts/api';
import type { RunEventPage } from '@beetle/contracts/api';
import type { RunEventsQuery, RunEventReader } from '../../ports/run-events.js';

/** Finite observational read; original reply remains owned through bounded capture. */
export async function getRunEvents(query: RunEventsQuery, reader: RunEventReader): Promise<RunEventPage> {
  const original = await reader.getRunEvents(query);
  const copy: unknown = JSON.parse(encodeJson(original, 262144));
  const checked = validateApi('RunEventPage', copy);
  if (!checked.ok || !runEventPageMatches(checked.value, query)) throw new Error('Invalid run event response');
  return checked.value;
}
