import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writePlanData } from '../../build/serialize.js';
import { validateAndCompileSuite } from '../../compiler/suite/validation.js';
import { compiled, dependencies, input } from '../suite/fixtures.js';
import { configFor, harness } from './fixtures.js';

function nestedBody(levels: number, leaf: unknown = 'leaf'): unknown {
  let value = leaf;
  for (let index = 0; index < levels; index++) value = { child: value };
  return value;
}
function deepestValue(value: unknown): number {
  if (value === null || typeof value !== 'object') return 0;
  return 1 + Math.max(0, ...Object.values(value).map(deepestValue));
}

describe('compiled JSON body serialization depth', () => {
  it.each(['inline', 'input'] as const)('serializes and renders the accepted depth32 %s body with a template leaf', async source => {
    const config = configFor('POST');
    const value = nestedBody(32, '{{data.users.user}}');
    const item = input(JSON.stringify(value));
    config.requests[0]!.body = source === 'inline' ? { kind: 'json', value }
      : { kind: 'input', format: 'json', input: item.ref };
    const suite = compiled(config, dependencies(source === 'inline' ? [] : [item]));
    // suite.requests[0].body.value is depth4; each object adds3, the template leaf adds4.
    expect(deepestValue(suite)).toBe(4 + 32 * 3 + 4);
    const test = harness(suite);
    expect(test.iterate().kind).toBe('completed');
    expect(JSON.parse(test.requests[0]!.body!)).toEqual(nestedBody(32, 'one'));
    const directory = await mkdtemp('/private/tmp/w09-r1-depth-');
    try {
      const path = join(directory, 'plan.json');
      await expect(writePlanData(path, suite)).resolves.toBe(Buffer.byteLength(JSON.stringify(suite)));
      expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(suite);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('keeps the public JSON depth32 limit and rejects one extra level', () => {
    const config = configFor('POST');
    config.requests[0]!.body = { kind: 'json', value: nestedBody(33) };
    expect(validateAndCompileSuite(config, dependencies())).toMatchObject({ ok: false, issues: [{ code: 'input_limit' }] });
  });
  it('rejects internal data one level beyond the derived depth104 before opening output', async () => {
    const directory = await mkdtemp('/private/tmp/w09-r1-depth-overflow-');
    try {
      const path = join(directory, 'plan.json');
      await expect(writePlanData(path, nestedBody(105))).rejects.toThrow('script_limit');
      expect(await readdir(directory)).toEqual([]);
      await expect(writePlanData(path, nestedBody(104))).resolves.toBeGreaterThan(0);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
