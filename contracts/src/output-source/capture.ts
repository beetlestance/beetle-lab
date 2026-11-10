import { encodeJson, encodeCanonicalJson } from '../json.js';
import { OutputSourceError } from './limits.js';
import type { Owned } from './types.js';

interface CaptureState { bytes: number; nodes: number; maximum: number; ancestors: Set<object> }
export function requireInput(condition: unknown): asserts condition {
  if (!condition) throw new OutputSourceError('invalid_input');
}
function charge(state: CaptureState, bytes: number): void {
  state.bytes += bytes; requireInput(state.bytes <= state.maximum);
}
function scalar(value: unknown, state: CaptureState): unknown {
  if (typeof value === 'number') requireInput(Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER);
  charge(state, new TextEncoder().encode(encodeJson(value, state.maximum)).byteLength);
  return value;
}
function data(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  requireInput(descriptor?.enumerable && 'value' in descriptor);
  return descriptor.value;
}
function array(value: unknown[], state: CaptureState, depth: number): unknown[] {
  requireInput(Object.getPrototypeOf(value) === Array.prototype && value.length <= 4096);
  requireInput(Reflect.ownKeys(value).length === value.length + 1);
  charge(state, 2 + Math.max(0, value.length - 1));
  const copy: unknown[] = [];
  for (let index = 0; index < value.length; index++) copy.push(visit(data(value, String(index)), state, depth + 1));
  return copy;
}
function object(value: object, state: CaptureState, depth: number): Record<string, unknown> {
  requireInput([Object.prototype, null].includes(Object.getPrototypeOf(value) as object | null));
  const keys = Reflect.ownKeys(value); requireInput(keys.length <= 4096);
  charge(state, 2 + Math.max(0, keys.length - 1));
  const copy: Record<string, unknown> = {};
  for (const key of keys) {
    requireInput(typeof key === 'string');
    scalar(key, state); charge(state, 1);
    Object.defineProperty(copy, key, { value: visit(data(value, key), state, depth + 1), enumerable: true });
  }
  return copy;
}
function visit(value: unknown, state: CaptureState, depth: number): unknown {
  requireInput(depth <= 64 && ++state.nodes <= 65_536);
  if (value === null || typeof value !== 'object') return scalar(value, state);
  requireInput(!state.ancestors.has(value)); state.ancestors.add(value);
  const copy = Array.isArray(value) ? array(value, state, depth) : object(value, state, depth);
  state.ancestors.delete(value); return copy;
}
export function freeze<T>(value: T): Owned<T> {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value as Owned<T>;
}
/**
 * Snapshot an already bounded producer carrier before encoding/foreign callbacks.
 * Copying and serialization are capped here. Native own-key reflection requires
 * that carrier provenance; arbitrary caller graphs are not a resource sandbox.
 */
export function capture(input: unknown, maximum: number): unknown {
  try { return freeze(visit(input, { bytes: 0, nodes: 0, maximum, ancestors: new Set() }, 0)); }
  catch { throw new OutputSourceError('invalid_input'); }
}
export function fields(input: unknown, names: string): Record<string, unknown> {
  requireInput(input !== null && typeof input === 'object' && !Array.isArray(input));
  requireInput(Object.keys(input).sort().join(',') === names.split(',').sort().join(','));
  return input as Record<string, unknown>;
}
export function canonical(input: unknown, maximum: number): string {
  try { return encodeCanonicalJson(input, maximum); }
  catch { throw new OutputSourceError('invalid_input'); }
}
export function checked<T>(work: () => T): T {
  try { return work(); }
  catch (error) {
    if (error instanceof OutputSourceError) throw error;
    throw new OutputSourceError('invalid_input');
  }
}
