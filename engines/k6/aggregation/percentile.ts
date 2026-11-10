import { bucketBound } from './exponential.js';
import { DistributionError } from './distribution-types.js';
import type { DurationPercentile, PercentileEstimate } from './distribution-types.js';
import { validateDistribution } from './distribution-validation.js';
export function distributionPercentile(input: unknown, percentile: DurationPercentile): PercentileEstimate | null {
  const distribution = validateDistribution(input);
  if (![50, 90, 95, 99].includes(percentile)) throw new DistributionError('invalid_value');
  const { count, zeroCount, min, max, scale, offset, buckets } = distribution;
  if (!count) return null;
  // Exact nearest-rank arithmetic, including populations at MAX_SAFE_INTEGER.
  const rank = Number((BigInt(count) * BigInt(percentile) + 99n) / 100n);
  let lower = min!; let upper = max!;
  if (rank <= zeroCount) { lower = 0; upper = 0; }
  else if (min !== max) {
    let cumulative = zeroCount;
    for (let index = 0; index < buckets.length; index++) {
      cumulative += buckets[index]!;
      if (cumulative >= rank) {
        lower = Math.max(min!, bucketBound(offset + index, scale, false));
        upper = Math.min(max!, bucketBound(offset + index + 1, scale, true));
        break;
      }
    }
  }
  return Object.freeze({ source: 'histogram-estimate', scale, lower, upper, estimate: lower + (upper - lower) / 2 });
}
