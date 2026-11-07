import { fail } from './failure.js';
import { suiteLimits, unsafeNames } from './limits.js';
import { hasControl, safeHeaderName } from './target.js';
import type { AssertionConfig, AssertionPlan, DeepReadonly } from './types.js';
/** Grammar: $ followed by .identifier or [nonnegative decimal index], no wildcards/predicates/quoted keys. */
export function parseJsonPath(value: string): (string | number)[] {
  if (value.length > 512 || !value.startsWith('$')) fail('assertion');
  const segments: (string | number)[] = [];
  let offset = 1;
  while (offset < value.length) {
    if (segments.length >= suiteLimits.jsonPathSegments) fail('assertion');
    const match = /^(?:\.([A-Za-z_][A-Za-z0-9_]*)|\[(0|[1-9][0-9]{0,9})\])/.exec(value.slice(offset));
    if (!match) fail('assertion');
    const segment = match[1] ?? Number(match[2]);
    validateSegment(segment);
    segments.push(segment); offset += match[0].length;
  }
  return segments;
}
function validateSegment(segment: string | number): void {
  if (typeof segment === 'string' && unsafeNames.has(segment)) fail('assertion');
  if (typeof segment === 'number' && segment > 1_000_000_000) fail('assertion');
}
export function compileAssertions(assertions: DeepReadonly<AssertionConfig[]>): AssertionPlan[] {
  const ids = new Set<string>();
  return assertions.map(assertion => {
    if (ids.has(assertion.id)) fail('duplicate_id', '/assertions');
    ids.add(assertion.id);
    if ('name' in assertion && !safeHeaderName(assertion.name)) fail('assertion');
    if ('value' in assertion && typeof assertion.value === 'string' && hasControl(assertion.value)
      && assertion.kind.startsWith('header')) fail('assertion');
    if ('path' in assertion) {
      const { path, ...rest } = assertion;
      return { ...rest, segments: parseJsonPath(path) };
    }
    return { ...assertion };
  });
}
