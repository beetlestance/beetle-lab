import { fail } from './failure.js';
import { canonical, checkedDigest } from './identity.js';
import { suiteLimits } from './limits.js';
import type { Digest, InputRef, ValidatedCompileInput, ValidatedSuiteConfig } from './types.js';
export interface LoadedInputs { content: ReadonlyMap<string, string>; refs: InputRef[] }
function references(config: ValidatedSuiteConfig): Map<string, InputRef> {
  const refs: InputRef[] = [];
  for (const dataset of config.datasets) if ('input' in dataset) refs.push(dataset.input);
  for (const request of config.requests) if (request.body?.kind === 'input') refs.push(request.body.input);
  const expected = new Map<string, InputRef>();
  for (const ref of refs) {
    const previous = expected.get(ref.id);
    if (previous && canonical(previous) !== canonical(ref)) fail('conflicting_dependency', '/inputs');
    expected.set(ref.id, ref);
  }
  return expected;
}
export function utf8Bytes(value: string): number {
  let bytes = 0;
  for (const point of value) {
    const code = point.codePointAt(0)!;
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
    if (bytes > suiteLimits.inputBytes) fail('input_limit', '/inputs');
  }
  return bytes;
}
export function loadInputs(config: ValidatedSuiteConfig, input: ValidatedCompileInput, digest: Digest): LoadedInputs {
  const expected = references(config);
  const content = new Map<string, string>();
  let total = 0;
  for (const item of input.inputs) {
    if (content.has(item.ref.id)) fail('conflicting_dependency', '/inputs');
    const ref = expected.get(item.ref.id);
    if (!ref || canonical(ref) !== canonical(item.ref)) fail('input_integrity', '/inputs');
    const bytes = utf8Bytes(item.content); total += bytes;
    if (total > suiteLimits.loadedBytes) fail('input_limit', '/inputs');
    if (bytes !== ref.bytes || checkedDigest(digest, item.content) !== ref.sha256) fail('input_integrity', '/inputs');
    content.set(ref.id, item.content);
  }
  if (content.size !== expected.size) fail('missing_dependency', '/inputs');
  return { content, refs: [...expected.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) };
}
