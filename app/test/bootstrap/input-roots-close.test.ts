import { expect, it, vi } from 'vitest';
import { mkdtemp, open, realpath, rm } from 'node:fs/promises';
import type * as FsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeInputRoots } from '../../src/bootstrap/input-roots.js';

vi.mock('node:fs/promises', async importOriginal => {
  const original = await importOriginal<typeof FsPromises>();
  return { ...original, open: vi.fn(original.open) };
});

it('retains initialization after an uncertain directory close and fences another startup without retry', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'beetle-input-close-')));
  const original = await vi.importActual<typeof FsPromises>('node:fs/promises');
  let entered!: () => void; const failed = new Promise<void>(resolve => { entered = resolve; });
  let closes = 0;
  vi.mocked(open).mockImplementation(async (path, flags, mode) => {
    const handle = await original.open(path, flags, mode); const close = handle.close.bind(handle);
    vi.spyOn(handle, 'close').mockImplementation(async () => {
      closes++;
      // Actually retire the test descriptor; expose an unknown outcome to production.
      await close(); entered(); throw new Error('Synthetic unknown close');
    });
    return handle;
  });
  try {
    let settled = false;
    void initializeInputRoots(join(root, 'inputs')).then(() => { settled = true; }, () => { settled = true; });
    await failed; await new Promise<void>(resolve => setImmediate(resolve));
    expect(settled).toBe(false); expect(closes).toBe(1); expect(open).toHaveBeenCalledTimes(1);
    await expect(initializeInputRoots(join(root, 'replacement'))).rejects.toMatchObject({ name: 'InputDirectoryError' });
    expect(open).toHaveBeenCalledTimes(1); expect(closes).toBe(1);
  } finally { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); }
});
