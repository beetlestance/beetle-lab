import { validateApi } from '@beetle/contracts/api';
import { StorageError } from './protocol.js';
/** Persisted data failures are unavailable, never a caller's invalid_input. */
export function storedRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new StorageError('unavailable');
  return input as Record<string, unknown>;
}
export function storedInteger(input: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < minimum || input > maximum)
    throw new StorageError('unavailable');
  return input;
}
export function storedFlag(input: unknown): 0 | 1 {
  if (input !== 0 && input !== 1) throw new StorageError('unavailable');
  return input;
}
export function storedUuid(input: unknown): string {
  if (typeof input !== 'string' || Buffer.byteLength(input) > 45) throw new StorageError('unavailable');
  const parsed = validateApi('Uuid', input);
  if (!parsed.ok) throw new StorageError('unavailable');
  return parsed.value;
}
export function storedTimestamp(input: unknown): string {
  if (typeof input !== 'string' || Buffer.byteLength(input) > 40) throw new StorageError('unavailable');
  const parsed = validateApi('RunTimestamp', input);
  if (!parsed.ok) throw new StorageError('unavailable');
  return parsed.value;
}
