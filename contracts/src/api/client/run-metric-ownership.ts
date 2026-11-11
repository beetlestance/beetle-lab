import { encodeJson } from '../../json.js';
import type { RunMetricSeriesPage, RunMetricSamplesPage } from '../generated/types.js';
import { captureRunMetricSeriesCursor } from './metric-cursors.js';
import { identity, bound, unavailable, ready, sampleSelection, samplePosition, sampleCoverage } from './metric-pages.js';
import type { Query } from './metric-pages.js';
export { encodeRunMetricSeriesCursor, captureRunMetricSeriesCursor, encodeRunMetricSamplesCursor, captureRunMetricSamplesCursor } from './metric-cursors.js';
/** Schema validation precedes scope, representation, cursor and full byte bounds. */
export function runMetricSeriesPageMatches(p: RunMetricSeriesPage, q: Query): boolean {
  try {
    encodeJson(p, 262144); if (!identity(p, q)) return false;
    const start = q.cursor === undefined ? null : captureRunMetricSeriesCursor(q.cursor);
    if (start && !bound(start, p)) return false;
    return p.availability === 'ready' ? ready(p, start?.nextOrdinal ?? 0) : unavailable(p, start);
  } catch { return false; }
}
export function runMetricSamplesPageMatches(p: RunMetricSamplesPage, q: Query): boolean {
  try {
    encodeJson(p, 262144);
    if (!identity(p, q) || !sampleSelection(p, q)) return false;
    return samplePosition(p, q) && sampleCoverage(p);
  } catch { return false; }
}
