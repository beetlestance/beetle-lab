import { Failure } from './failure.js';
export function storedRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Failure('unavailable');
  return input as Record<string, unknown>;
}
export function storedInteger(input: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < minimum || input > maximum)
    throw new Failure('unavailable');
  return input;
}
export function storedFlag(input: unknown): 0 | 1 {
  if (input !== 0 && input !== 1) throw new Failure('unavailable');
  return input;
}

export function storedText(input: unknown, maximum: number): string {
  if (typeof input !== 'string' || Buffer.byteLength(input) > maximum) throw new Failure('unavailable');
  return input;
}
export function storedJson(input: unknown, maximum: number): unknown {
  const text = storedText(input, maximum);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Failure('unavailable');
  }
}
