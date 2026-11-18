import { expect, it } from 'vitest';
import { validateK6DraftPart } from './k6-draft.js';
it('validates the bundled dataset variants and secret references without accepting unknown fields', () => {
  expect(
    validateK6DraftPart('dataset', {
      id: 'users',
      kind: 'inline',
      selection: 'byVu',
      rows: [{ id: 1, enabled: true, note: null }],
    }),
  ).toBe(true);
  expect(
    validateK6DraftPart('dataset', {
      id: 'ids',
      kind: 'range',
      selection: 'random',
      column: 'id',
      start: 1,
      end: 10,
      step: 1,
    }),
  ).toBe(true);
  expect(validateK6DraftPart('dataset', { id: 'users', kind: 'inline', selection: 'byVu', rows: 'invalid text' })).toBe(
    false,
  );
  expect(
    validateK6DraftPart('secret', { name: 'api_token', provider: 'env', locator: 'TOKEN_REF', version: 'v1' }),
  ).toBe(true);
  expect(
    validateK6DraftPart('secret', {
      name: 'api_token',
      provider: 'env',
      locator: 'TOKEN_REF',
      value: 'never accepted',
    }),
  ).toBe(false);
});
it('bounds serialization and refuses oversized, cyclic and non-JSON draft values', () => {
  expect(validateK6DraftPart('dataset', { payload: 'x'.repeat(1_048_577) })).toBe(false);
  const cycle: { self?: unknown } = {};
  cycle.self = cycle;
  expect(validateK6DraftPart('dataset', cycle)).toBe(false);
  expect(validateK6DraftPart('secret', undefined)).toBe(false);
});
it('keeps JSON scalar types distinct and rejects nested values and overlong strings', () => {
  for (const value of [true, false, null, 1, 'true', 'confirmed'])
    expect(validateK6DraftPart('scalar', value)).toBe(true);
  for (const value of [undefined, {}, [], Infinity, 'x'.repeat(4097)])
    expect(validateK6DraftPart('scalar', value)).toBe(false);
});
