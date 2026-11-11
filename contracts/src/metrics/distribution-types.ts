/** Duration units follow k6 trend output (milliseconds). */
export interface DurationDistribution {
  readonly format: 'exponential-v1';
  readonly unit: 'ms';
  readonly scale: number;
  readonly offset: number;
  readonly buckets: readonly number[];
  readonly zeroCount: number;
  readonly count: number;
  readonly min: number | null;
  readonly max: number | null;
}
export type DurationPercentile = 50 | 90 | 95 | 99;
export interface PercentileEstimate {
  readonly source: 'histogram-estimate';
  readonly scale: number;
  readonly estimate: number;
  readonly lower: number;
  readonly upper: number;
}
export class DistributionError extends Error {
  constructor(readonly code: 'invalid_distribution' | 'invalid_value' | 'overflow') {
    super('Duration distribution rejected'); this.name = 'DistributionError';
  }
}
export function countSum(left: number, right: number): number {
  const sum = left + right;
  if (!Number.isSafeInteger(sum)) throw new DistributionError('overflow');
  return sum;
}
