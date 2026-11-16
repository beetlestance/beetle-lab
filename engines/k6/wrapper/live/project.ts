import { metricSeriesIdentity, projectMetricSeries, type MetricWindow } from '@beetle/contracts/metrics';
import type { LiveMetricSubset } from '@beetle/contracts/api';

/** The source is the trusted accumulator; only selected values are retained. */
export function projectWindow(window: MetricWindow, subset: LiveMetricSubset) {
  if (!Number.isSafeInteger(window.startTimeMs) || window.startTimeMs < 0
    || window.endTimeMs > 8640000000000000 || window.endTimeMs - window.startTimeMs !== 1000
    || window.series.length > 4096) throw new Error('Invalid window');
  const selected = new Map(subset.selected.map(row => [metricSeriesIdentity(row), row.ordinal]));
  const series = []; const ordinals = new Set<number>();
  for (const row of window.series) {
    const ordinal = selected.get(metricSeriesIdentity(row));
    if (ordinal === undefined) continue;
    if (ordinals.has(ordinal)) throw new Error('Duplicate selected series');
    ordinals.add(ordinal); series.push(projectMetricSeries(row, ordinal));
  }
  return {startTimeMs: window.startTimeMs, endTimeMs: window.endTimeMs, series};
}
