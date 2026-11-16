import { describe, expect, it } from 'vitest';
import { validateAndCompileSuite, validateCompileInput } from '../../compiler/suite/validation.js';
import { compiled, dependencies, fixture, input } from './fixtures.js';
describe('immutable input manifest integrity', () => {
  it('rejects missing, unknown, duplicate and conflicting manifests and verifies content bytes/digest', () => {
    const item = input('a\nx'); const config = fixture();
    config.datasets.push({ id: 'csv', kind: 'csv', selection: 'random', input: item.ref });
    expect(validateAndCompileSuite(config, dependencies()).ok).toBe(false);
    expect(validateAndCompileSuite(fixture(), dependencies([item])).ok).toBe(false);
    expect(validateAndCompileSuite(config, dependencies([item, item])).ok).toBe(false);
    expect(validateAndCompileSuite(config, dependencies([{ ...item, content: 'a\ny' }])).ok).toBe(false);
    expect(validateAndCompileSuite(config, dependencies([{ ...item, ref: { ...item.ref, bytes: item.ref.bytes + 1 } }])).ok).toBe(false);
    const conflicting = { ...item.ref, sha256: 'a'.repeat(64) };
    config.requests[1]!.body = { kind: 'input', format: 'text', input: conflicting };
    expect(validateAndCompileSuite(config, dependencies([item]))).toMatchObject({ ok: false, issues: [{ code: 'conflicting_dependency' }] });
  });
  it('uses UTF-8 bytes, pins manifest once and isolates content/reference mutation', () => {
    const item = input('a\né'); const config = fixture(); const deps = dependencies([item]);
    config.datasets.push({ id: 'csv', kind: 'csv', selection: 'random', input: item.ref });
    const first = compiled(config, deps);
    expect(first.identity.inputs[0]?.bytes).toBe(4);
    item.content = 'mutated'; item.ref.sha256 = 'f'.repeat(64);
    expect(first.datasets[2]?.rows).toEqual([{ a: 'é' }]);
    expect(first.identity.inputs[0]?.sha256).not.toBe('f'.repeat(64));
  });
  it('rejects >8MiB content and >32MiB total before parsing or copying input content', () => {
    const oversized = input('x'.repeat(8_388_609));
    expect(validateCompileInput(dependencies([oversized]))).toMatchObject({ ok: false, issues: [{ code: 'input_limit' }] });
    const unicode = input('é'.repeat(4_194_305));
    expect(validateCompileInput(dependencies([unicode]))).toMatchObject({ ok: false, issues: [{ code: 'input_limit' }] });
    const full = 'x'.repeat(8_388_608);
    const atLimit = Array.from({ length: 4 }, (_, index) => input(full, index + 1));
    expect(validateCompileInput(dependencies(atLimit)).ok).toBe(true);
    expect(validateCompileInput(dependencies([...atLimit, input('x', 5)]))).toMatchObject({ ok: false, issues: [{ code: 'input_limit' }] });
  });
  it('rejects invalid UUID/hash/size dependencies and mutable/accessor injection objects', () => {
    const item = input('a\nx');
    for (const patch of [{ id: '../host' }, { sha256: 'bad' }, { bytes: -1 }]) {
      expect(validateCompileInput(dependencies([{ ...item, ref: { ...item.ref, ...patch } }])).ok).toBe(false);
    }
    let calls = 0; Object.defineProperty(item, 'content', { get() { calls++; return 'secret'; }, enumerable: true });
    expect(validateCompileInput(dependencies([item])).ok).toBe(false); expect(calls).toBe(0);
  });
});
