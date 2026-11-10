import { EventBatchError } from './types.js';

/** Expiry of a stale remote request cannot erase a prefix already durable locally. */
export function expiryCoverage(after: number, retainedStartSeq: number, durableThrough: number): 'covered' | 'gap' {
  if (![after, retainedStartSeq, durableThrough].every(value => Number.isSafeInteger(value) && value >= 0)) {
    throw new EventBatchError('invalid_batch');
  }
  if (after > durableThrough || retainedStartSeq <= after || retainedStartSeq - after <= 1) {
    throw new EventBatchError('invalid_batch');
  }
  return retainedStartSeq > durableThrough && retainedStartSeq - durableThrough > 1 ? 'gap' : 'covered';
}
