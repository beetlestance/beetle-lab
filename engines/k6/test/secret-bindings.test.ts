import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { validate } from '@beetle/contracts';
import type { Offer } from '@beetle/contracts';
import { fixture, dependencies } from './suite/fixtures.js';
import { validateSuiteConfig, validateAndCompileSuite } from '../compiler/suite/validation.js';
import { prepareSecretReferences, matchSecretReferences } from '../wrapper/input/index.js';

async function bound() {
  const config = fixture(); config.secrets = [{ name: '_TOKEN', provider: 'env', locator: '_SOURCE', version: 'v'.repeat(256) }];
  config.requests[0]!.headers = { Authorization: 'Bearer {{secret._TOKEN}}' };
  const checked = validateSuiteConfig(config); if (!checked.ok) throw new Error('Invalid fixture');
  const refs = prepareSecretReferences(checked.value); if (!refs.ok) throw new Error('Invalid bindings');
  const offer = JSON.parse(await readFile('contracts/fixtures/valid/offer.json', 'utf8')) as Offer;
  offer.config = config; offer.secretReferences = [...refs.value];
  return { config, checked: checked.value, offer };
}
it('carries valid compiler secret names/versions through runner contracts without resolving values', async () => {
  const { config, checked, offer } = await bound();
  expect(validateAndCompileSuite(config, dependencies()).ok).toBe(true);
  expect(validate('Offer', offer).ok).toBe(true);
  expect(offer.secretReferences).toEqual([{ name: '_TOKEN', provider: 'env', reference: '_SOURCE', version: 'v'.repeat(256) }]);
  expect(matchSecretReferences(checked, offer)).toBe(true);
});
it('rejects mismatched, missing, duplicate and extra bindings or invented versions', async () => {
  const { checked, offer } = await bound(); const expected = offer.secretReferences![0]!;
  const noVersion = { ...expected }; delete noVersion.version;
  for (const refs of [[], [expected, expected], [{ ...expected, reference: 'OTHER' }],
    [{ ...expected, provider: 'mounted' as const }], [noVersion], [{ ...expected, name: '_token' }]]) {
    expect(matchSecretReferences(checked, { ...offer, secretReferences: refs })).toBe(false);
  }
});
it.each([{ provider: 'vault', locator: 'source' }, { provider: 'mounted', locator: '/private/secret' }])('rejects unsupported first-release references %s', descriptor => {
  const config = fixture(); config.secrets = [{ name: 'TOKEN', ...descriptor }];
  const checked = validateSuiteConfig(config); if (!checked.ok) throw new Error('Invalid fixture');
  expect(prepareSecretReferences(checked.value)).toEqual({ ok: false, code: 'unsupported_secret_reference' });
});
it('rejects portable filename collisions before resolving or staging anything', () => {
  const config = fixture(); config.secrets = [{ name: 'TOKEN', provider: 'env', locator: 'A' }, { name: 'token', provider: 'mounted', locator: 'B' }];
  const checked = validateSuiteConfig(config); if (!checked.ok) throw new Error('Invalid fixture');
  expect(prepareSecretReferences(checked.value)).toEqual({ ok: false, code: 'conflicting_secret_reference' });
});
