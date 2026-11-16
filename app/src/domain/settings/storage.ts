export interface StorageFitInput {
  readonly chargedBytes: number;
  readonly requestedBytes: number;
  readonly allocationBytes: number;
  readonly reserveBytes: number;
}
/** Subtraction keeps the calculation inside the safe integer range. */
export function storageFits(input: StorageFitInput): boolean {
  const { chargedBytes, requestedBytes, allocationBytes, reserveBytes } = input;
  if (!Object.values(input).every(value => Number.isSafeInteger(value) && value >= 0)) return false;
  const available = allocationBytes - reserveBytes;
  return available >= chargedBytes && requestedBytes <= available - chargedBytes;
}
