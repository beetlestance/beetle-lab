import { constants } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { expect, it } from 'vitest';
import { createPublication } from '../../wrapper/publication/operation.js';
import { clean, fileProxy, input, nodeIo } from './fixtures.js';
import type { PublicationIo } from '../../wrapper/publication/ports.js';

const highDevice = (1n << 61n) + 7n;
const directoryInode = (1n << 58n) + 12n;
const fileInode = (1n << 58n) + 28n;
type Mutation = 'named-parent' | 'opened-parent' | 'opened-file' | 'pending' | 'final';
type Component = 'dev' | 'ino';
function withIdentity(stat: BigIntStats, ino: bigint, change: boolean, component: Component): BigIntStats {
  return Object.assign(stat, { dev: highDevice + (change && component === 'dev' ? 1n : 0n),
    ino: ino + (change && component === 'ino' ? 1n : 0n) });
}
function highIdentities(directory: string, mutation?: Mutation, component: Component = 'ino'): PublicationIo {
  let namedParents = 0; let openedParents = 0; let openedFiles = 0;
  return { ...nodeIo,
    lstat: async path => {
      const stat = await nodeIo.lstat(path);
      const ino = path === directory ? directoryInode : fileInode; let change = false;
      if (path === directory && ++namedParents === 2 && mutation === 'named-parent') change = true;
      if (path.includes('.engine-result.pending-') && mutation === 'pending') change = true;
      if (path.endsWith('/engine-result.json') && mutation === 'final') change = true;
      return withIdentity(stat, ino, change, component);
    },
    open: async (path, flags, mode) => {
      const file = await nodeIo.open(path, flags, mode); const parent = mode === undefined;
      return fileProxy(file, { stat: async () => {
        const stat = await file.stat(); const ino = parent ? directoryInode : fileInode; let change = false;
        if (parent && ++openedParents === 3 && mutation === 'opened-parent') change = true;
        if (!parent && ++openedFiles === 2 && mutation === 'opened-file') change = true;
        return withIdentity(stat, ino, change, component);
      } });
    },
  };
}
it('default adapters request true bigint stats for both named paths and opened descriptors', async () => {
  const options = await input();
  const parent = await nodeIo.open(options.directory, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    for (const stat of [await nodeIo.lstat(options.directory), await parent.stat()]) {
      for (const key of ['dev', 'ino', 'uid', 'mode', 'nlink', 'size'] as const) expect(typeof stat[key]).toBe('bigint');
    }
  } finally { await parent.close(); await clean(options); }
});
it('accepts stable exact64-bit device/inode identities while keeping public JSON numeric', async () => {
  const options = await input();
  try {
    const op = createPublication(options, highIdentities(options.directory)); const result = await op.result; await op.quiesced;
    expect(result.ok).toBe(true); if (!result.ok) throw new Error('publication failed');
    expect(typeof result.bytes).toBe('number'); expect(() => JSON.stringify(result)).not.toThrow();
  } finally { await clean(options); }
});
it.each((['named-parent', 'opened-parent', 'opened-file', 'pending', 'final'] as const)
  .flatMap(mutation => (['dev', 'ino'] as const).map(component => ({ mutation, component }))))(
  'rejects adjacent high-bit $mutation $component differing by exactly1', async ({ mutation, component }) => {
    const options = await input();
    try {
      const op = createPublication(options, highIdentities(options.directory, mutation, component));
      expect(await op.result).toEqual({ ok: false, code: 'integrity', publication: 'unconfirmed' }); await op.quiesced;
    } finally { await clean(options); }
  });
