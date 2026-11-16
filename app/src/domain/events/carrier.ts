import { EventBatchError } from './types.js';

/** Fixed own data fields only; payload values remain unobserved until their owner captures them. */
export function captureFields(input: unknown, names: readonly string[]): Record<string, unknown> {
  if (input === null || typeof input !== 'object'
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input) as object | null)) throw new EventBatchError('invalid_batch');
  const keys = Reflect.ownKeys(input);
  if (keys.length !== names.length || keys.some(key => typeof key !== 'string' || !names.includes(key))) {
    throw new EventBatchError('invalid_batch');
  }
  const output: Record<string, unknown> = {};
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(input, name);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw new EventBatchError('invalid_batch');
    output[name] = descriptor.value as unknown;
  }
  return output;
}
