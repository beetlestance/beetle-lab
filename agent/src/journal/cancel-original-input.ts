import { offerInput } from './input.js';
import { checkedWallTime } from './supervision.js';

function ownValue(input: object, field: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(input, field);
  if (!descriptor?.enumerable || !('value' in descriptor)) throw new Error('invalid_input');
  return descriptor.value;
}
/** Inspect the small carrier separately, so Offer retains its full node/depth budget. */
export function captureCancelledOriginal(input: { offer: unknown; now: number }): { json: string; canonical: string; now: number } {
  if (!input || typeof input !== 'object'
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input) as object | null)) throw new Error('invalid_input');
  const fields = Reflect.ownKeys(input);
  if (fields.length !== 2 || !fields.includes('offer') || !fields.includes('now')) throw new Error('invalid_input');
  const offer = ownValue(input, 'offer');
  const now = ownValue(input, 'now') as number;
  checkedWallTime(now);
  return { ...offerInput(offer), now };
}
