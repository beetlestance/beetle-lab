import { OutputFailure } from '../output/index.js';
import type { PrefixLines } from './lines.js';

export function fields(input: unknown, names: readonly string[]): Record<string, unknown> {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).length !== names.length ||
    names.some((name) => !Object.hasOwn(input, name))
  )
    throw new OutputFailure('integrity');
  return input as Record<string, unknown>;
}
export async function required(lines: PrefixLines, maximum: number) {
  const line = await lines.next(maximum);
  if (!line) throw new OutputFailure('integrity');
  return line;
}
