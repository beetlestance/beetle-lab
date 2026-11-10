import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import { Custody, Directories, nativePort, pinRoots, promoteVerifiedFile } from '../../src/adapters/outbound/files/custody/index.js';
import { context, fixture } from './inputs/fixture.js';

it.each([
  { bytes: 0, ancestors: true }, { bytes: 3, ancestors: true },
  { bytes: 0, ancestors: false }, { bytes: 3, ancestors: false },
])('returns false without reconstructing absent $bytes-byte content (ancestors=$ancestors)', async ({ bytes, ancestors }) => {
  const open = vi.fn(nativePort.open); const port = { ...nativePort, open };
  const files = await fixture(port); const owner = new Custody(port, context);
  try {
    const roots = await pinRoots(port, files.stagingRoot, files.publishedRoot);
    const tree = new Directories(owner, roots);
    const content = { bytes, sha256: createHash('sha256').update(Buffer.alloc(bytes)).digest('hex') };
    const name = { components: ['synthetic-promotion'], name: content.sha256 };
    const stage = await tree.location(roots.stage, name, ancestors);
    const destination = await tree.location(roots.published, name, ancestors);
    expect(await promoteVerifiedFile({ tree, content, stage, destination })).toBe(false);
    await expect(lstat(stage.path)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(lstat(destination.path)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(open.mock.calls.every(call => (call[1] & constants.O_CREAT) === 0)).toBe(true);
    expect(await readdir(stage.parent.path)).toEqual([]);
    expect(await readdir(destination.parent.path)).toEqual([]);
  } finally {
    expect(await owner.close()).toBe(true); await files.dispose();
  }
});
