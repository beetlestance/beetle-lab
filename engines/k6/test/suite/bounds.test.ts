import { describe, expect, it } from 'vitest';
import { validateAndCompileSuite, validateSuiteConfig } from '../../compiler/suite/validation.js';
import { dependencies, fixture, input } from './fixtures.js';
describe('suite allocation and cardinality bounds', () => {
  it('rejects oversized config JSON and template/field/token limits', () => {
    const config = fixture(); config.requests[0]!.body = { kind: 'json', value: 'x'.repeat(1_048_577) };
    expect(validateSuiteConfig(config).ok).toBe(false);
    config.requests[0]!.body = { kind: 'json', value: '{{secret.auth}}' + 'x'.repeat(4097) };
    expect(validateAndCompileSuite(config, dependencies()).ok).toBe(false);
    config.requests[0]!.body = { kind: 'json', value: '{{secret.auth}}'.repeat(129) };
    expect(validateAndCompileSuite(config, dependencies()).ok).toBe(false);
  });
  it('rejects >64 requests/datasets/columns and >64 assertions', () => {
    const requestOverflow = fixture(); requestOverflow.requests = Array.from({ length: 65 }, (_, i) => ({ ...requestOverflow.requests[0]!, id: 'r' + i, name: 'r' + i }));
    expect(validateAndCompileSuite(requestOverflow, dependencies()).ok).toBe(false);
    const datasetOverflow = fixture(); datasetOverflow.datasets = Array.from({ length: 65 }, (_, i) => ({ id: 'd' + i, kind: 'range', selection: 'byVu', column: 'x', start: 1, end: 1, step: 1 }));
    expect(validateAndCompileSuite(datasetOverflow, dependencies()).ok).toBe(false);
    const columnOverflow = fixture(); columnOverflow.datasets.push({ id: 'bad', kind: 'inline', selection: 'random', rows: [Object.fromEntries(Array.from({ length: 65 }, (_, i) => ['c' + i, 1]))] });
    expect(validateAndCompileSuite(columnOverflow, dependencies()).ok).toBe(false);
    const assertionOverflow = fixture(); assertionOverflow.requests[0]!.assertions = Array.from({ length: 65 }, (_, i) => ({ id: 'a' + i, kind: 'statusEq', required: true, value: 200 }));
    expect(validateAndCompileSuite(assertionOverflow, dependencies()).ok).toBe(false);
  });
  it('caps external JSON nesting/tokens and rejects oversized data cells', () => {
    for (const content of ['['.repeat(33) + '0' + ']'.repeat(33), '[{"a":"' + 'x'.repeat(4097) + '"}]',
      '[{"a":"' + 'x'.repeat(24_577) + '"}]', '[' + '0,'.repeat(500_000) + '0]']) {
      const item = input(content); const config = fixture(); config.datasets.push({ id: 'bad', kind: 'json', selection: 'random', input: item.ref });
      expect(validateAndCompileSuite(config, dependencies([item])).ok).toBe(false);
    }
  });
  it('bounds repeated input expansion across datasets before each parse', () => {
    const content = 'a\n' + ('x'.repeat(4095) + '\n').repeat(2047);
    const item = input(content); const config = fixture();
    config.datasets.push(...Array.from({ length: 5 }, (_, index) => ({ id: 'd' + index, kind: 'csv' as const,
      selection: 'random' as const, input: item.ref })));
    expect(validateAndCompileSuite(config, dependencies([item]))).toMatchObject({ ok: false, issues: [{ code: 'input_limit' }] });
  });
  it('bounds aggregate JSON body-plan nodes across requests', () => {
    const item = input(JSON.stringify(Array.from({ length: 4096 }, () => 1)));
    const config = fixture(); config.requests.push(...Array.from({ length: 17 }, (_, index) => ({
      id: 'extra' + index, name: 'extra' + index, method: 'POST' as const, path: '/body', query: {}, headers: {},
      assertions: [], body: { kind: 'input' as const, format: 'json' as const, input: item.ref },
    })));
    expect(validateAndCompileSuite(config, dependencies([item]))).toMatchObject({ ok: false, issues: [{ code: 'input_limit' }] });
  });

});
