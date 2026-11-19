import { expect, it } from 'vitest';
import { releaseIdentities } from '../src/selection.js';

const identity = (schemaDigest: string, profileId = 'k6-local') => ({
  catalogVersion: 1,
  manifestId: 'k6-v1',
  profileId,
  schemaDigest,
});
const derived = { profiles: [{ installedIdentity: identity('b'.repeat(64)) }], origin: 'http://127.0.0.1:4567' };

it('keeps the selected schema digest when manifest, profile and catalog version are unchanged', () => {
  const selected = { profiles: [{ installedIdentity: identity('a'.repeat(64)) }], origin: 'http://127.0.0.1:4567' };
  expect(releaseIdentities(derived, selected)).toEqual(selected);
});

it('leaves every other difference in place for the drift check', () => {
  const otherProfile = { profiles: [{ installedIdentity: identity('a'.repeat(64), 'k6-other') }] };
  expect(releaseIdentities(derived, otherProfile)).toEqual(derived);
  expect(releaseIdentities(derived, { ...derived, origin: 'https://other.invalid' })).toEqual(derived);
  expect(releaseIdentities(derived, {})).toEqual(derived);
});
