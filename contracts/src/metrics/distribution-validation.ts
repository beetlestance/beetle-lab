import { bucketIndex } from './exponential.js';
import { countSum, DistributionError } from './distribution-types.js';
import type { DurationDistribution } from './distribution-types.js';
const fields = ['format', 'unit', 'scale', 'offset', 'buckets', 'zeroCount', 'count', 'min', 'max'];
function invalid(): never { throw new DistributionError('invalid_distribution'); }
function exactObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length || keys.some(key => typeof key !== 'string' || !fields.includes(key))) return invalid();
  for (const key of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return invalid();
  }
  return value as Record<string, unknown>;
}
function safe(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function duration(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0; }
function header(value: Record<string, unknown>): void {
  if (value.format !== 'exponential-v1' || value.unit !== 'ms') invalid();
  const { scale, offset } = value;
  if (typeof scale !== 'number' || !Number.isInteger(scale) || scale < -10 || scale > 4) return invalid();
  if (typeof offset !== 'number' || !Number.isInteger(offset)) return invalid();
}
function empty(value: DurationDistribution): void {
  if (value.min !== null || value.max !== null || value.zeroCount || value.buckets.length || value.offset || value.scale !== 4) invalid();
}
function zeroOnly(value: DurationDistribution): void {
  if (value.max !== 0 || value.offset || value.scale !== 4) invalid();
}
function positiveExtrema(value: DurationDistribution): void {
  const { min, max, scale, offset, buckets, count, zeroCount } = value;
  if (bucketIndex(max!, scale) !== offset + buckets.length - 1) invalid();
  if (min! > 0 && bucketIndex(min!, scale) !== offset) invalid();
  if (count - zeroCount === 1 && min! > 0 && min !== max) invalid();
  if (offset < bucketIndex(Number.MIN_VALUE, scale)) invalid();
  if (offset + buckets.length - 1 > bucketIndex(Number.MAX_VALUE, scale)) invalid();
}
function extrema(value: DurationDistribution): void {
  const { count, min, max, zeroCount, buckets } = value;
  if (count === 0) { empty(value); return; }
  if (!duration(min) || !duration(max) || min > max) return invalid();
  if ((min === 0) !== (zeroCount > 0)) return invalid();
  if (!buckets.length) { zeroOnly(value); return; }
  if (max === 0) invalid();
  positiveExtrema(value);
}
function counterAt(buckets: readonly unknown[], index: number): number {
  const descriptor = Object.getOwnPropertyDescriptor(buckets, String(index));
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value') || !safe(descriptor.value)) return invalid();
  return descriptor.value as number;
}
function endpoints(buckets: readonly number[]): void {
  if (buckets.length && (buckets[0] === 0 || buckets[buckets.length - 1] === 0)) invalid();
}
function counts(value: Record<string, unknown>): void {
  const { buckets, count, zeroCount } = value;
  if (!Array.isArray(buckets) || buckets.length > 64) return invalid();
  if (!safe(count) || !safe(zeroCount)) return invalid();
  const keys = Reflect.ownKeys(buckets);
  if (keys.length !== buckets.length + 1) return invalid();
  let sum = zeroCount;
  for (let index = 0; index < buckets.length; index++) sum = countSum(sum, counterAt(buckets, index));
  if (sum !== count) invalid();
  endpoints(buckets);
}
/** Caller admits <=2KiB standalone JSON before parse, or supplies a bounded data
 * object (not a hostile reflective proxy). Check array length before count iteration. */
export function validateDistribution(input: unknown): DurationDistribution {
  const value = exactObject(input);
  header(value); counts(value);
  const result = value as unknown as DurationDistribution;
  extrema(result);
  return result;
}
