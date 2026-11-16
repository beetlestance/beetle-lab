import type { MetricWindow } from './series-types.js';
import { captureMetricSeries } from './capture-series.js';
import { metricSeriesIdentity } from './identity.js';
import { object, integer, invalid, array } from './capture-fields.js';
export function captureMetricWindow(input: unknown): MetricWindow {
  const v = object(input, ['startTimeMs', 'endTimeMs', 'series']);
  const startTimeMs = integer(v.startTimeMs, 8640000000000000); const endTimeMs = integer(v.endTimeMs, 8640000000000000);
  if (endTimeMs - startTimeMs !== 1000) return invalid();
  const series = array(v.series, 4096).map(captureMetricSeries);
  if (new Set(series.map(metricSeriesIdentity)).size !== series.length) return invalid();
  if (series.some(s => s.total.kind === 'gauge' && (s.total.sourceTimeMs < startTimeMs || s.total.sourceTimeMs >= endTimeMs))) return invalid();
  return {startTimeMs, endTimeMs, series};
}
