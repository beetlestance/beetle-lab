import type { AdmissionSnapshot, Candidate, Decision } from './types.js';

export const DISK_HOLD_LIMIT = 4096;
export const DISK_HOLD_METADATA_BYTES = 512;
export const MAX_DISK_TOTAL = Number.MAX_SAFE_INTEGER;

/** Bytes include only retained holds; heldCount includes both active and retained. */
export interface DiskRetention {
  readonly heldCount: number;
  readonly outputBytes: number;
  readonly stagingBytes: number;
}
/** Exact policy signature amendment; callers must supply durable retention facts. */
export type AdmissionDecider = (candidate: Candidate, snapshot: AdmissionSnapshot, retention: DiskRetention) => Decision;

const names = ['heldCount', 'outputBytes', 'stagingBytes'] as const;
function fields(input: unknown): object {
  if (input === null || typeof input !== 'object'
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input) as object | null)) throw new Error();
  const keys = Reflect.ownKeys(input);
  if (keys.length !== names.length || keys.some(key => typeof key !== 'string' || !names.includes(key as typeof names[number]))) throw new Error();
  return input;
}
function scalar(input: object, name: typeof names[number]): number {
  const field = Object.getOwnPropertyDescriptor(input, name);
  if (!field?.enumerable || !('value' in field)) throw new Error();
  const value: unknown = field.value;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error();
  return value;
}
/** Closed scalar carrier captured before serialization can discard own properties. */
export function captureDiskRetention(input: unknown): Readonly<DiskRetention> {
  try {
    const original = fields(input);
    const heldCount = scalar(original, 'heldCount');
    const outputBytes = scalar(original, 'outputBytes');
    const stagingBytes = scalar(original, 'stagingBytes');
    if (heldCount > DISK_HOLD_LIMIT || heldCount === 0 && (outputBytes !== 0 || stagingBytes !== 0)) throw new Error();
    return Object.freeze({ heldCount, outputBytes, stagingBytes });
  } catch { throw new Error('invalid_input'); }
}
