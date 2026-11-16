import { chmod } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { opened, syntheticInstalledIdentity } from '../staged-input/fixtures.js';
import { stagedFixture } from './staged-fixture.js';

it('binds the actual manifest written by the synthetic native fixture without running k6', async () => {
  const value = await stagedFixture('https://example.invalid');
  try {
    expect(value.offer.installedIdentity).toEqual(syntheticInstalledIdentity(value.manifest));
    const session = await opened({ ...value.options, headerTimeoutMs: 5000 });
    try {
      expect(session.offer.installedIdentity).toEqual(value.offer.installedIdentity);
      const compile = session.compile(); const result = await compile.result; await compile.quiesced;
      expect(result.ok).toBe(true);
    } finally { await session.close(); }
  } finally {
    for (const root of [value.options.inputRoot, value.options.secretRoot]) await chmod(root, 0o700);
    await value.cleanup();
  }
});
