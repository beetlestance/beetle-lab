import { expect, it } from 'vitest';
import { validate } from '@beetle/contracts';
import { validateApi } from '@beetle/contracts/api';
import { makeRunOffer } from '../../src/adapters/outbound/sqlite/run-offer.js';
import { checkedRunConfiguration } from '../../src/adapters/outbound/execution-profiles/index.js';
import { runOptions } from './runs-fixture.js';
import runFixture from '../../../contracts/fixtures/api/valid/run.json' with { type: 'json' };
import revisionFixture from '../../../contracts/fixtures/api/valid/suite-revision.json' with { type: 'json' };

it('binds every installed identity field to the immutable Offer intent, separate from its browser alias', () => {
  const run = validateApi('Run', runFixture); const revision = validateApi('SuiteRevision', revisionFixture);
  if (!run.ok || !revision.ok) throw new Error('Invalid synthetic fixture');
  const profile = runOptions().runs!.profiles[0]!;
  const original = validate('Offer', JSON.parse(makeRunOffer(run.value, revision.value, profile)));
  if (!original.ok) throw new Error('Invalid generated Offer');
  expect(original.value.installedIdentity).toEqual(profile.installedIdentity);
  expect(original.value.installedIdentity.profileId).not.toBe(profile.engine.profileId);
  for (const [field, value] of Object.entries(profile.installedIdentity)) {
    const changed = structuredClone(profile);
    Object.assign(changed.installedIdentity, { [field]: typeof value === 'number' ? value + 1
      : field.endsWith('Digest') ? 'f'.repeat(64) : value + '-changed' });
    const offer = validate('Offer', JSON.parse(makeRunOffer(run.value, revision.value, changed)));
    if (!offer.ok) throw new Error('Invalid changed Offer');
    expect(offer.value.intentDigest, field).not.toBe(original.value.intentDigest);
  }
  const alias = structuredClone(profile); alias.engine.profileId = 'another-browser-alias';
  expect(makeRunOffer(run.value, revision.value, alias)).toBe(JSON.stringify(original.value));
});

it('refuses missing, extra or malformed identity pins without accepting caller digest labels', () => {
  for (const identity of [undefined, {}, { ...runOptions().runs!.profiles[0]!.installedIdentity, catalogVersion: 0 },
    { ...runOptions().runs!.profiles[0]!.installedIdentity, extra: true }]) {
    const config = runOptions().runs!;
    Object.assign(config.profiles[0]!, { installedIdentity: identity });
    expect(() => checkedRunConfiguration(config)).toThrow();
  }
});
