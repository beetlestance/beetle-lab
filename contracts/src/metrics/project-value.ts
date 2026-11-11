import type { RunMetricValue, RunMetricSeries } from '../api/generated/types.js';
import type { NumericTotal, SeriesTotal } from './series-types.js';
import { distributionPercentile } from './percentile.js';
import { DistributionError } from './distribution-types.js';

function fail(): never { throw new DistributionError('invalid_value'); }
/** Project a previously validated total; never merge or average percentile estimates. */
export function projectMetricValue(total: NumericTotal): RunMetricValue {
  if (total.kind === 'rate') return {...total, ratio: total.sampleCount ? total.numerator / total.sampleCount : null};
  if (total.kind !== 'trend') return {...total};
  const {distribution, ...value} = total;
  const p = (n: 50 | 90 | 95 | 99) => distributionPercentile(distribution, n) ?? fail();
  return {...value, percentiles: {p50: p(50), p90: p(90), p95: p(95), p99: p(99)}};
}

/** Same descriptor projection for historical and advisory source-window values. */
export function projectMetricSeries(value: SeriesTotal, ordinal: number): RunMetricSeries {
  if (value.scope !== 'execute' && value.scope !== 'engine') return fail();
  const unit = value.kind === 'trend' ? 'ms' : value.kind === 'rate' ? 'ratio'
    : ['data_received', 'data_sent'].includes(value.metric) ? 'bytes' : 'count';
  return {ordinal, metric: value.metric, kind: value.kind, scope: value.scope, tags: {...value.tags}, unit, total: projectMetricValue(value.total)};
}
