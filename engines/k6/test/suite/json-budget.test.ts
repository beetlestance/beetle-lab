import { describe, expect, it, vi } from 'vitest';
import { compileSuite } from '../../compiler/suite/index.js';
import { parseInputJson } from '../../compiler/suite/json.js';
import { sha256, validateCompileInput, validateSuiteConfig } from '../../compiler/suite/validation.js';
import type { ValidatedCompileInput, ValidatedSuiteConfig } from '../../compiler/suite/index.js';
import { dependencies, fixture, input } from './fixtures.js';
function pinnedBodies(contents: string[]): { config: ValidatedSuiteConfig; input: ValidatedCompileInput } {
  const config = fixture();
  const source = config.requests[0]!;
  const items = contents.map((content, index) => input(content, index + 1));
  config.requests = items.map((item, index) => ({ ...source, id: 'r' + index, name: 'r' + index,
    body: { kind: 'input', format: 'json', input: item.ref } }));
  config.selections = [{ scenarioId: 'main', entries: [{ requestId: 'r0', weight: 1,
    wait: { durationMs: 0, jitterMs: 0 } }] }];
  const validated = validateSuiteConfig(config);
  const injected = validateCompileInput(dependencies(items));
  if (!validated.ok || !injected.ok) throw new Error('Invalid pinned fixture');
  return { config: validated.value, input: injected.value };
}
function numericArray(length: number): string { return '[' + Array.from({ length }, () => '1').join(',') + ']'; }
function compileObserved(contents: string[]): { parses: number; result: ReturnType<typeof compileSuite> } {
  // Instrument only after the config and content manifests have been independently validated.
  const pinned = pinnedBodies(contents);
  const parse = vi.spyOn(JSON, 'parse');
  try {
    const result = compileSuite(pinned.config, { input: pinned.input, digest: sha256 });
    return { result, parses: parse.mock.calls.length };
  } finally { parse.mockRestore(); }
}
function directObserved(text: string, remaining: number): { parses: number; error: unknown; value: unknown } {
  const parse = vi.spyOn(JSON, 'parse');
  let value: unknown;
  let error: unknown;
  let parses: number;
  try { value = parseInputJson(text, remaining); }
  catch (failure) { error = failure; }
  finally { parses = parse.mock.calls.length; parse.mockRestore(); }
  return { parses, error, value };
}
describe('external JSON body admission before materialization', () => {
  it('admits exactly 65536 aggregate nodes, then rejects the next body without parsing it', () => {
    const full = [...Array.from({ length: 15 }, () => numericArray(4096)), numericArray(4080)];
    expect(compileObserved(full)).toMatchObject({ parses: 16, result: { ok: true } });
    expect(compileObserved([...full, '0'])).toMatchObject({ parses: 16,
      result: { ok: false, issues: [{ code: 'input_limit' }] } });
  });
  it('rejects a numeric array requiring more nodes than remain before parsing it', () => {
    const prefix = [...Array.from({ length: 15 }, () => numericArray(4096)), numericArray(4078)];
    expect(compileObserved([...prefix, '[0]'])).toMatchObject({ parses: 17, result: { ok: true } });
    expect(compileObserved([...prefix, '[0,1]'])).toMatchObject({ parses: 16,
      result: { ok: false, issues: [{ code: 'input_limit' }] } });
  });
  it.each(['0', '-12.5e+2', '"text"', 'true', 'false', 'null', '[]', '{}'])('counts root %s as one node', text => {
    expect(directObserved(text, 1)).toMatchObject({ parses: 1, error: undefined });
    expect(directObserved(text, 0)).toMatchObject({ parses: 0, error: { code: 'input_limit' } });
  });
  it.each([
    ['[0,1]', 3], ['{"only":1}', 2], ['{"a":[0,{"b":true}],"c":null}', 6],
    [String.raw`{"key\"colon:":["quote\"",{"slash\\key":"back\\slash"}]}`, 5],
    ['{"escaped\\u003akey\\u002c":[]}', 2],
  ] as const)('counts values but excludes keys and separators in %s', (text, nodes) => {
    const exact = directObserved(text, nodes);
    expect(exact.error).toBeUndefined(); expect(exact.parses).toBe(1);
    expect(directObserved(text, nodes - 1)).toMatchObject({ parses: 0, error: { code: 'input_limit' } });
  });
  it.each(['{"a":', '[1,]', '{"unterminated}', 'not-json', ''])('preserves safe typed rejection for malformed input %j', content => {
    const observed = compileObserved([content]);
    expect(observed.result).toMatchObject({ ok: false, issues: [{ code: 'invalid_json' }] });
    expect(observed.parses).toBe(1);
  });
});
