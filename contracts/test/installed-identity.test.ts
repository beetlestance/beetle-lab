import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { deriveInstalledIdentity, installedDescriptorDigest, sameInstalledIdentity, validate } from '../src/index.js';
import { fixture } from './fixtures.js';

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
const labels = { manifestId: 'manifest-v1', profileId: 'local-default', catalogVersion: 1, schemaDigest: 'c'.repeat(64) };

it('hashes the complete descriptor with a kind-specific domain and exact canonical preimage', () => {
  const digest = vi.fn(sha256);
  const value = { z: ['☃', { '2': true, '10': false }], a: 1 };
  installedDescriptorDigest('profile', value, digest);
  expect(digest).toHaveBeenCalledExactlyOnceWith('beetle-lab.installed-profile.v1\n{"a":1,"z":["☃",{"10":false,"2":true}]}');
  expect(installedDescriptorDigest('profile', Object.fromEntries(Object.entries(value).reverse()), sha256))
    .toBe(installedDescriptorDigest('profile', value, sha256));
});

it('derives immutable content identities and binds every descriptor field and label', async () => {
  const manifest = await fixture('valid/manifest.json');
  const input = { manifest, profile: { user: '1000:1000', network: 'test-local' }, identity: { ...labels } };
  const identity = deriveInstalledIdentity(input, sha256);
  expect(validate('InstalledIdentity', identity).ok).toBe(true);
  expect(Object.isFrozen(identity)).toBe(true);
  input.profile.network = 'other-local';
  expect(deriveInstalledIdentity(input, sha256).profileDigest).not.toBe(identity.profileDigest);
  const changedManifest = { ...(manifest as object), engineVersion: '2.0.0' };
  expect(deriveInstalledIdentity({ ...input, manifest: changedManifest }, sha256).manifestDigest).not.toBe(identity.manifestDigest);
  for (const [field, value] of Object.entries(identity)) {
    const changed = { ...identity, [field]: typeof value === 'number' ? value + 1 : value + 'x' };
    expect(sameInstalledIdentity(identity, changed)).toBe(false);
  }
  expect(sameInstalledIdentity(identity, { ...identity })).toBe(true);
  input.identity.profileId = 'changed';
  expect(identity.profileId).toBe('local-default');
});

it('rejects malformed, oversized or accessor descriptors before invoking the digest', async () => {
  const manifest = await fixture('valid/manifest.json');
  const digest = vi.fn(sha256);
  const getter = vi.fn(() => 'PRIVATE_CANARY');
  const accessor = Object.defineProperty({}, 'a', { enumerable: true, get: getter });
  for (const profile of [null, [], 'text', { a: 'x'.repeat(65536) }, accessor]) {
    expect(() => deriveInstalledIdentity({ manifest, profile, identity: labels }, digest)).toThrow('Installed identity rejected');
  }
  expect(() => installedDescriptorDigest('manifest', {}, digest)).toThrow('Installed identity rejected');
  expect(getter).not.toHaveBeenCalled();
  // A valid manifest may be hashed first; the invalid descriptor itself is never hashed.
  expect(digest.mock.calls.every(([text]) => text.startsWith('beetle-lab.installed-manifest.v1\n'))).toBe(true);
});

it('rejects extra labels, unsafe versions and control characters; sanitizes digest failures', async () => {
  const manifest = await fixture('valid/manifest.json');
  for (const identity of [{ ...labels, manifestDigest: 'f'.repeat(64) }, { ...labels, catalogVersion: 0 },
    { ...labels, profileId: 'bad\nprofile' }, { ...labels, manifestId: '' }]) {
    expect(() => deriveInstalledIdentity({ manifest, profile: {}, identity }, sha256)).toThrow('Installed identity rejected');
  }
  for (const digest of [() => 'invalid', () => { throw new Error('PRIVATE_CANARY'); }]) {
    try { installedDescriptorDigest('profile', {}, digest); throw new Error('Expected rejection'); }
    catch (error) { expect(error).toMatchObject({ code: 'digest_failed', message: 'Installed identity rejected' }); }
  }
});
