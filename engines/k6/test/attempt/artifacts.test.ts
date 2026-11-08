import * as fs from 'node:fs/promises';
import { promises as realFs } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { Artifacts } from '../../wrapper/attempt/artifacts.js';
import { AttemptFence } from '../../wrapper/attempt/fence.js';

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof fs>();
  return { ...actual, open: vi.fn(actual.open) };
});

const cleanup: (() => Promise<unknown> | void)[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(cleanup.splice(0).map(work => work())); });
async function setup() {
  const directory = await fs.mkdtemp('/private/tmp/w09-attempt-custody-');
  cleanup.push(() => fs.rm(directory, { recursive: true, force: true }));
  const fence = new AttemptFence({ wall: Date.now, monotonic: () => performance.now() }, new AbortController().signal, 5000);
  cleanup.push(() => fence.dispose());
  return { directory, fence, artifacts: new Artifacts({ directory, uid: process.getuid!(), fence }) };
}
it('does not declare summary metadata from a trusted hash without real filesystem custody', async () => {
  const f = await setup(); await fs.writeFile(join(f.directory, 'beetle-evidence.json'), '{}', { mode: 0o600 });
  await expect(f.artifacts.summary({ version: 2, timing: { testRunDurationMs: null }, metrics: {},
    rawBytes: 2, sha256: '0'.repeat(64), nativeCollection: 'complete' })).rejects.toMatchObject({ reason: 'artifact' });
  expect(f.artifacts.quiescence).toBe('confirmed');
});
it('retains original descriptor-close failure and does not declare a partially successful numeric file', async () => {
  const f = await setup(); const original = realFs.open;
  vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
    const handle = await original(...args);
    if (args[0] === join(f.directory, 'numeric-final.json')) {
      const close = handle.close.bind(handle);
      handle.close = async () => { await close(); throw new Error('SECRET_FD_CLOSE'); };
    }
    return handle;
  });
  await expect(f.artifacts.numeric({ version: 1, quantiles: 'unknown' })).rejects.toMatchObject({ reason: 'cleanup' });
  expect(f.artifacts.quiescence).toBe('failed');
  expect(await fs.readFile(join(f.directory, 'numeric-final.json'), 'utf8')).toContain('unknown');
});
it('rejects final serialization overflow before creating a numeric file', async () => {
  const f = await setup();
  await expect(f.artifacts.numeric({ data: 'x'.repeat(1_048_576) })).rejects.toMatchObject({ reason: 'output_limit' });
  await expect(fs.lstat(join(f.directory, 'numeric-final.json'))).rejects.toMatchObject({ code: 'ENOENT' });
});
it('rejects cancellation before any artifact IO', async () => {
  const f = await setup(); f.fence.stop('cancelled');
  await expect(f.artifacts.numeric({ version: 1 })).rejects.toMatchObject({ reason: 'cancelled' });
  expect(await fs.readdir(f.directory)).toEqual([]);
});
