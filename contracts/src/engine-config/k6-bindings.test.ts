import { expect, it } from 'vitest';
import { prepareK6SecretReferences } from './k6.js';
it('snapshots opaque references and preserves declared versions without resolving values', () => {
  const declarations = [{ name: '_TOKEN', provider: 'env', locator: '_SOURCE', version: 'v2' }];
  const result = prepareK6SecretReferences(declarations); declarations[0]!.locator = 'CHANGED';
  expect(result).toEqual({ ok: true, value: [{ name: '_TOKEN', provider: 'env', reference: '_SOURCE', version: 'v2' }] });
  if (!result.ok) throw new Error('Expected supported binding');
  expect(Object.isFrozen(result.value)).toBe(true); expect(Object.isFrozen(result.value[0])).toBe(true);
});
it('rejects unsupported providers, paths, duplicate portable names and unknown fields', () => {
  for (const declarations of [[{ name: 'TOKEN', provider: 'vault', locator: 'SOURCE' }],
    [{ name: 'TOKEN', provider: 'mounted', locator: '/private/source' }],
    [{ name: 'TOKEN', provider: 'env', locator: 'SOURCE', value: 'synthetic' }]]) {
    expect(prepareK6SecretReferences(declarations)).toEqual({ ok: false, code: 'unsupported_secret_reference' });
  }
  expect(prepareK6SecretReferences([{ name: 'TOKEN', provider: 'env', locator: 'A' },
    { name: 'token', provider: 'env', locator: 'B' }])).toEqual({ ok: false, code: 'conflicting_secret_reference' });
});
it('retains all64 supported escaped maximum versions and rejects65 declarations', () => {
  const declarations = Array.from({ length: 64 }, (_, index) => ({ name: `TOKEN_${index}`, provider: 'env',
    locator: `SOURCE_${index}`, version: '\u0000'.repeat(256) }));
  expect(prepareK6SecretReferences(declarations)).toMatchObject({ ok: true, value: expect.arrayContaining([
    { name: 'TOKEN_63', provider: 'env', reference: 'SOURCE_63', version: '\u0000'.repeat(256) }]) });
  expect(prepareK6SecretReferences([...declarations, { ...declarations[0]!, name: 'EXTRA' }]))
    .toEqual({ ok: false, code: 'unsupported_secret_reference' });
});
it('does not execute caller accessors', () => {
  let reads = 0;
  const declaration = { name: 'TOKEN', provider: 'env', get locator() { reads++; return 'SOURCE'; } };
  expect(prepareK6SecretReferences([declaration])).toEqual({ ok: false, code: 'unsupported_secret_reference' });
  expect(reads).toBe(0);
});
