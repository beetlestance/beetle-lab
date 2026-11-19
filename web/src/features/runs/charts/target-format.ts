import { reading } from '../live/format.js';

/** Shared live/result presentation; positive tiny readings must not become displayed zeroes. */
export function targetCardReading(
  card: { readonly normalized: boolean; readonly unit: string },
  value: number,
): string {
  const magnitude = Math.abs(value);
  const text = magnitude >= 1e12 || (magnitude > 0 && magnitude < 0.001) ? value.toExponential(2) : reading(value);
  return !card.normalized || card.unit === 'count' ? text : card.unit === '%' ? `${text}%` : `${text} ${card.unit}`;
}
