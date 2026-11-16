import { encodeJson, validate, validatePrimitive } from '@beetle/contracts';
import type { ProtocolName } from '@beetle/contracts';
import type { GenerationKey } from '../../src/journal/index.js';

export const MAXIMUM = 2_101_248;
export function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid fixture object');
  return input as Record<string, unknown>;
}
export function fields(input: unknown, keys: string[]): Record<string, unknown> {
  const value = object(input);
  if (Object.keys(value).sort().join() !== [...keys].sort().join()) throw new Error('Invalid fixture fields');
  return value;
}
export function checked<N extends ProtocolName>(name: N, input: unknown) {
  const result = validate(name, input);
  if (!result.ok) throw new Error('Invalid fixture protocol');
  return result.value;
}
export function key(input: unknown): GenerationKey {
  const value = fields(input, ['attemptId', 'organizationId', 'workspaceId', 'generation']);
  for (const name of ['attemptId', 'organizationId', 'workspaceId']) {
    if (!validatePrimitive('uuid', value[name]).ok) throw new Error('Invalid fixture scope');
  }
  if (value.generation !== 1) throw new Error('Invalid fixture generation');
  return value as unknown as GenerationKey;
}
export function send(value: unknown): Promise<void> {
  const text = encodeJson(value, MAXIMUM) + '\n';
  return new Promise((resolve, reject) => { process.stdout.write(text, error => { if (error) reject(error); else resolve(); }); });
}
