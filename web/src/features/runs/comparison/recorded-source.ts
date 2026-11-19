import { sameChartSource } from '../result/chart-model.js';
import type { RunMetricOverview, RunChartHistory } from '@beetle/contracts/api';
import type { OverviewRead, ChartRead } from './useComparison.js';
/** A peak belongs to this numeric original, not a configured load or another publication. */
export function comparisonPeak(overview: OverviewRead | undefined, history: ChartRead | undefined): number | null {
  if (
    overview?.status !== 'loaded' ||
    overview.value.availability !== 'ready' ||
    history?.status !== 'loaded' ||
    history.value.reason !== null
  )
    return null;
  return matchingRecordedSource(overview.value, history.value) ? history.value.observedPeakRequestsPerSecond : null;
}
function matchingRecordedSource(overview: RunMetricOverview, history: RunChartHistory): boolean {
  const a = overview.source,
    b = history.source;
  return (
    !!a &&
    !!b &&
    a.generation === b.generation &&
    a.numericVersion === b.numericVersion &&
    sameChartSource(overview, history)
  );
}
