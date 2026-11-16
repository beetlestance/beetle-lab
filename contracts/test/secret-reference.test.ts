import { expect, it } from 'vitest';
import { validatePrimitive } from '../src/index.js';

it('accepts leading underscore aliases and bounded opaque declared versions', () => {
  expect(validatePrimitive('secretReference', { name: '_TOKEN', provider: 'env', reference: '_TOKEN', version: 'v'.repeat(256) }).ok).toBe(true);
  expect(validatePrimitive('secretReference', { name: 'api-token', provider: 'mounted', reference: 'token-ref' }).ok).toBe(true);
});
it.each(['/mounted/token', '../token', 'env:TOKEN', 'TOKEN/name', 'TOKEN\n', '', 'x'.repeat(129)])('rejects non-alias reference %s', reference => {
  expect(validatePrimitive('secretReference', { name: 'TOKEN', provider: 'mounted', reference }).ok).toBe(false);
});
it('rejects unsupported providers, extra values and over-limit versions', () => {
  const reference = { name: 'TOKEN', provider: 'env', reference: 'TOKEN' };
  for (const patch of [{ provider: 'vault' }, { value: 'MUST_NOT_RESOLVE' }, { version: 'v'.repeat(257) }]) {
    expect(validatePrimitive('secretReference', { ...reference, ...patch }).ok).toBe(false);
  }
});
