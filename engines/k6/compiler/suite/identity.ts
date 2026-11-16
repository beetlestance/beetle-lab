import { fail } from './failure.js';
import type { Digest } from './types.js';
/** Call only for bounded validated JSON; lexical ordering is independent of process locale. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const object = value as Record<string, unknown>;
  return '{' + Object.keys(object).sort().map(key => JSON.stringify(key) + ':' + canonical(object[key])).join(',') + '}';
}
export function checkedDigest(digest: Digest, value: string): string {
  let result: string;
  try { result = digest(value); } catch { return fail('digest'); }
  if (!/^[a-f0-9]{64}$/.test(result)) fail('digest');
  return result;
}
