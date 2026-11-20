/** Plain words for the availability and reason codes comparison reads return; codes never reach the page. */
const phrases: Readonly<Record<string, string>> = {
  not_requested: 'not chosen yet',
  pending: 'still being prepared',
  missing: 'not recorded',
  absent: 'not recorded',
  not_recorded: 'not recorded',
  not_applicable: 'not applicable to this run',
  unavailable: 'unavailable right now',
  unsupported_format: 'recorded in a format this version cannot read',
  too_large: 'too large to show',
  result_absent: 'the run has no result',
  source_absent: 'the recorded data was removed',
  not_observed: 'nothing was observed',
  logical_input_absent: 'an input it used is missing',
};

export function availabilityText(code: string): string {
  return phrases[code] ?? 'unavailable';
}

/** "not recorded" or "unavailable right now (the run has no result)". */
export function availabilityWithReason(availability: string, reason: string | null | undefined): string {
  const main = availabilityText(availability);
  if (!reason) return main;
  const why = availabilityText(reason);
  return why === main ? main : `${main} (${why})`;
}
