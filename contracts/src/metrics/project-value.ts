import type { RunMetricValue } from '../api/generated/types.js';
import type { NumericTotal } from './series-types.js';
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
