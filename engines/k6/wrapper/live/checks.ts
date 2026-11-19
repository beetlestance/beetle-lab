import { K6_LIVE_CHECKS } from '@beetle/contracts/k6-live';
import { projectMetricSeries } from '@beetle/contracts/metrics';
import type { SeriesTotal } from '@beetle/contracts/metrics';
import type { LiveMetricSubset } from '@beetle/contracts/api';

function nativeCheck(row: SeriesTotal): boolean {
  return (
    row.metric === 'checks' &&
    row.scope === 'execute' &&
    row.tags.phase === 'execute' &&
    row.tags.assertion !== undefined &&
    row.tags.request === undefined
  );
}

/** Pool the complete native window before the display subset discards assertion series. */
export function projectChecks(window: readonly SeriesTotal[], subset: LiveMetricSubset) {
  const approved = subset.selected.find((row) => row.metric === K6_LIVE_CHECKS);
  if (!approved) return undefined;
  let numerator = 0;
  let sampleCount = 0;
  const assertions = new Set<string>();
  for (const row of window) {
    if (!nativeCheck(row)) continue;
    const total = row.total;
    const assertion = row.tags.assertion!;
    if (total.kind !== 'rate' || assertions.has(assertion)) throw new Error('Invalid native check series');
    assertions.add(assertion);
    numerator += total.numerator;
    sampleCount += total.sampleCount;
  }
  if (!sampleCount) return undefined;
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(sampleCount) || numerator > sampleCount)
    throw new Error('Invalid pooled check rate');
  return projectMetricSeries({ ...approved, total: { kind: 'rate', numerator, sampleCount } }, approved.ordinal);
}
