import { validatePrimitive } from '@beetle/contracts';
import { requireRule } from '../../../../domain/namespaces/index.js';
import type { EventScan } from '../../../../ports/events.js';
export function closed(input: object, keys: readonly string[]): void {
  requireRule(input !== null && typeof input === 'object' && Object.keys(input).length === keys.length);
  requireRule(Object.keys(input).every(key => keys.includes(key)));
}
export function natural(input: unknown): asserts input is number {
  requireRule(typeof input === 'number' && Number.isSafeInteger(input) && input >= 0);
}
export function cursor(input: unknown): asserts input is string {
  requireRule(typeof input === 'string' && Buffer.byteLength(input) <= 1024);
}
export function scanQuery(input: EventScan): void {
  closed(input, input.cursor === undefined ? ['limit'] : ['limit', 'cursor']);
  natural(input.limit); requireRule(input.limit >= 1 && input.limit <= 32);
  if (input.cursor !== undefined) cursor(input.cursor);
}
export function token(input: unknown): void { requireRule(validatePrimitive('uuid', input).ok); }
