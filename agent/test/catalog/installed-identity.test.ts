import { expect, it } from 'vitest';
import { deriveInstalledIdentity } from '@beetle/contracts';
import { createHash } from 'node:crypto';
import { createEngineCatalog } from '../../src/catalog/index.js';
import { offer, registration } from './fixtures.js';

it('derives immutable complete pins from actual snapshots, disregarding caller digest labels', () => {
  const original = registration();
  const catalog = createEngineCatalog([{ ...original, installedIdentity: { ...offer().installedIdentity, manifestDigest: '0'.repeat(64), profileDigest: '0'.repeat(64) } } as typeof original]);
  const engine = catalog.engines[0]!;
  expect(engine.installedIdentity).toEqual(deriveInstalledIdentity({ manifest: original.manifest,
    profile: original.profile, identity: original.validation }, value => createHash('sha256').update(value).digest('hex')));
  expect(Object.isFrozen(engine.installedIdentity)).toBe(true);
  original.manifest.capabilities.push('changed');
  expect(catalog.preflight(offer()).engine).toBe(engine);
});
it.each(['manifestId', 'profileId', 'catalogVersion', 'manifestDigest', 'profileDigest', 'schemaDigest'] as const)(
  'rejects %s drift in both intake and resolution', field => {
    const catalog = createEngineCatalog([registration()]); const job = offer();
    const accepted = catalog.preflight(job);
    const value = job.installedIdentity[field];
    job.installedIdentity = { ...job.installedIdentity,
      [field]: typeof value === 'number' ? value + 1 : field.endsWith('Digest') ? 'f'.repeat(64) : `${value}-changed` };
    expect(() => catalog.preflight(job)).toThrow('Engine catalog identity');
    expect(() => catalog.resolve(job, accepted.validation)).toThrow('Engine catalog identity');
  });
it.each(['manifest', 'profile'] as const)('rejects changed actual %s under an identical selector and opaque labels', kind => {
  const before = registration(); const job = offer(before);
  const after = registration();
  if (kind === 'manifest') after.manifest.engineVersion = 'changed-version';
  else Object.assign(after.profile, { tmpfsBytes: after.profile.tmpfsBytes + 1 });
  const catalog = createEngineCatalog([after]);
  expect(catalog.engines[0]!.validation).toEqual(before.validation);
  expect(() => catalog.preflight(job)).toThrow('Engine catalog identity');
});
