import { bucketIndex } from './exponential.js';
import { countSum, DistributionError } from './distribution-types.js';
import type { DurationDistribution } from './distribution-types.js';
import { validateDistribution } from './distribution-validation.js';

/** Fixed storage, no retained samples and no per-record array copies. */
export class DurationHistogram {
  private counters = new Float64Array(64);
  private scale = 4;
  private offset = 0;
  private length = 0;
  private count = 0;
  private zeroCount = 0;
  private min: number | null = null;
  private max: number | null = null;
  record(value: number): void {
    if (!Number.isFinite(value) || value < 0) throw new DistributionError('invalid_value');
    const count = countSum(this.count, 1);
    if (value === 0) this.zeroCount++;
    else this.positive(value);
    this.count = count;
    this.min = Math.min(this.min ?? value, value); this.max = Math.max(this.max ?? value, value);
  }
  private positive(value: number): void {
    let index = bucketIndex(value, this.scale);
    while (this.length && Math.max(index, this.offset + this.length - 1) - Math.min(index, this.offset) >= 64) {
      this.downscale(); index = bucketIndex(value, this.scale);
    }
    if (!this.length) { this.offset = index; this.length = 1; }
    if (index < this.offset) {
      const shift = this.offset - index;
      this.counters.copyWithin(shift, 0, this.length); this.counters.fill(0, 0, shift);
      this.length += shift; this.offset = index;
    }
    this.length = Math.max(this.length, index - this.offset + 1);
    this.counters[index - this.offset]!++;
  }
  private downscale(): void {
    const offset = Math.floor(this.offset / 2);
    const next = new Float64Array(64);
    for (let index = 0; index < this.length; index++) {
      next[Math.floor((this.offset + index) / 2) - offset]! += this.counters[index]!;
    }
    this.length = Math.floor((this.offset + this.length - 1) / 2) - offset + 1;
    this.offset = offset; this.scale--; this.counters = next;
  }
  snapshot(): DurationDistribution {
    return Object.freeze({ format: 'exponential-v1', unit: 'ms', scale: this.scale, offset: this.offset,
      buckets: Object.freeze(Array.from(this.counters.subarray(0, this.length))),
      count: this.count, zeroCount: this.zeroCount, min: this.min, max: this.max });
  }
}
function range(input: DurationDistribution, scale: number): readonly [number, number] | undefined {
  if (!input.buckets.length) return undefined;
  const factor = 2 ** (input.scale - scale);
  return [Math.floor(input.offset / factor), Math.floor((input.offset + input.buckets.length - 1) / factor)];
}
function combinedRange(left: DurationDistribution, right: DurationDistribution, scale: number): readonly [number, number] {
  const a = range(left, scale); const b = range(right, scale);
  if (!a) return b ?? [0, -1];
  if (!b) return a;
  return [Math.min(a[0], b[0]), Math.max(a[1], b[1])];
}
function add(input: DurationDistribution, scale: number, offset: number, buckets: number[]): void {
  const factor = 2 ** (input.scale - scale);
  for (let index = 0; index < input.buckets.length; index++) {
    const target = Math.floor((input.offset + index) / factor) - offset;
    buckets[target] = countSum(buckets[target]!, input.buckets[index]!);
  }
}
/** Pure merge: callers bind identity, labels, phase and disjoint time coverage. */
export function mergeDistributions(leftInput: unknown, rightInput: unknown): DurationDistribution {
  const left = validateDistribution(leftInput); const right = validateDistribution(rightInput);
  const count = countSum(left.count, right.count); const zeroCount = countSum(left.zeroCount, right.zeroCount);
  let scale = Math.min(left.scale, right.scale);
  let [offset, end] = combinedRange(left, right, scale);
  while (end - offset >= 64) { scale--; [offset, end] = combinedRange(left, right, scale); }
  if (end < offset) scale = 4;
  const buckets: number[] = Array.from({ length: end - offset + 1 }, () => 0);
  add(left, scale, offset, buckets); add(right, scale, offset, buckets);
  const min = left.min === null ? right.min : right.min === null ? left.min : Math.min(left.min, right.min);
  const max = left.max === null ? right.max : right.max === null ? left.max : Math.max(left.max, right.max);
  return Object.freeze({ format: 'exponential-v1', unit: 'ms', scale, offset,
    buckets: Object.freeze(buckets), count, zeroCount, min, max });
}
