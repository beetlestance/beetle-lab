import { expect, it, vi } from 'vitest';
import { readdir } from 'node:fs/promises';
import { fixture } from './fixtures.js';

const f = fixture();
it.each(['manifestId', 'profileId', 'catalogVersion', 'manifestDigest', 'profileDigest', 'schemaDigest'] as const)(
  'independently rejects offered %s drift before providers or task writes', async field => {
    const e = await f.environment(); const offer = structuredClone(e.offer);
    const original = offer.installedIdentity[field];
    offer.installedIdentity = { ...offer.installedIdentity,
      [field]: typeof original === 'number' ? original + 1 : field.endsWith('Digest') ? 'f'.repeat(64) : `${original}-changed` };
    const read = vi.spyOn(e.owner, 'readOffer').mockResolvedValue(offer);
    const input = vi.fn(e.options.providers.input); const secret = vi.fn(e.options.providers.secret);
    const write = vi.spyOn(e.owner, 'supervision');
    const task = e.prepare(e.create({ providers: { input, secret } }));
    expect(await task.result).toEqual({ ok: false, reason: 'reservation' }); await task.quiesced;
    expect(input).not.toHaveBeenCalled(); expect(secret).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
    expect(await readdir(e.rootPath)).toEqual([]); read.mockRestore(); write.mockRestore();
  });
it.each(['manifest', 'profile'] as const)('compares actual captured %s semantics independently of catalogue callers', async kind => {
  const e = await f.environment();
  const manifest = structuredClone(e.options.manifest); const profile = structuredClone(e.options.profile);
  if (kind === 'manifest') manifest.engineVersion = 'changed';
  else Object.assign(profile, { tmpfsBytes: profile.tmpfsBytes + 1 });
  const input = vi.fn(e.options.providers.input); const secret = vi.fn(e.options.providers.secret);
  const stager = e.create({ manifest, profile, providers: { input, secret } });
  const task = e.prepare(stager);
  expect(await task.result).toEqual({ ok: false, reason: 'reservation' }); await task.quiesced;
  expect(input).not.toHaveBeenCalled(); expect(secret).not.toHaveBeenCalled();
  expect(await readdir(e.rootPath)).toEqual([]);
});
