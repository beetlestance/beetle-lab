const bits = new DataView(new ArrayBuffer(8));
/** Extract the exact binary exponent and normalized significand, including subnormals. */
function parts(value: number): { exponent: number; mantissa: number } {
  let adjustment = 0;
  if (value < 2 ** -1022) { value *= 2 ** 52; adjustment = -52; }
  bits.setFloat64(0, value);
  const high = bits.getUint32(0);
  const exponent = ((high >>> 20) & 2047) - 1023 + adjustment;
  bits.setUint32(0, (high & 0xfffff) | 0x3ff00000);
  return { exponent, mantissa: bits.getFloat64(0) };
}
/** Only rounded fractional-edge ties need integer arithmetic (at most 832 bits).
 * m^width compares exactly with 2^edge; all other comparisons use ordered doubles.
 */
function belowEdge(mantissa: number, edge: number, width: number): boolean {
  const boundary = 2 ** (edge / width);
  if (mantissa !== boundary) return mantissa < boundary;
  return BigInt(mantissa * 2 ** 52) ** BigInt(width) <= 1n << BigInt(52 * width + edge);
}
/** OTel buckets are (2^(i/2^scale), 2^((i+1)/2^scale)]. */
export function bucketIndex(value: number, scale: number): number {
  const { exponent, mantissa } = parts(value);
  if (scale <= 0) return Math.floor((exponent - Number(mantissa === 1)) / 2 ** -scale);
  const width = 2 ** scale;
  if (mantissa === 1) return exponent * width - 1;
  let low = 1; let high = width;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (belowEdge(mantissa, middle, width)) high = middle;
    else low = middle + 1;
  }
  return exponent * width + low - 1;
}
/** Outward rounding makes theoretical bucket bounds conservative in binary64.
 * Under/overflow is clipped to the finite nonnegative duration domain.
 */
export function bucketBound(index: number, scale: number, upper: boolean): number {
  const value = 2 ** (index * 2 ** -scale);
  if (value === Infinity) return Number.MAX_VALUE;
  if (value === 0) return upper ? Number.MIN_VALUE : 0;
  bits.setFloat64(0, value);
  const raw = bits.getBigUint64(0);
  bits.setBigUint64(0, upper ? raw + 1n : raw - 1n);
  return Math.min(Number.MAX_VALUE, bits.getFloat64(0));
}
