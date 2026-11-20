/** Show the magnitude of a change between two distinct recorded values. */
export function relativePercent(base: number, value: number): string | null {
  if (base === 0) return null;
  const magnitude = Math.abs(((value - base) / base) * 100);
  if (!Number.isFinite(magnitude)) return null;
  const rounded = Math.round(magnitude);
  if (rounded === 0) return '<1%';
  if (rounded !== 100) return `${rounded}%`;
  if (value === 0 || value === 2 * base) return '100%';
  return value < 2 * base ? '<100%' : '>100%';
}
