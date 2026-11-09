import type { FileHandle } from 'node:fs/promises';
import { rm } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { nativeDisk } from '../../src/adapters/outbound/capacity/disk.js';
import { deferred, fixture } from './fixture.js';

describe('root startup identity and close custody', () => {
  it('closes an opened root after failed identity verification before reporting failure', async () => {
    const f = await fixture(); const originalOpen = f.disk.open;
    const close = vi.spyOn(f.disk, 'close');
    f.disk.open = async (path, flags) => {
      const handle = await originalOpen(path, flags);
      vi.spyOn(handle, 'stat').mockRejectedValue(new Error('private-canary'));
      return handle;
    };
    try { await expect(f.open()).rejects.toThrow('Capacity source unavailable'); expect(close).toHaveBeenCalledTimes(1); }
    finally { await f.cleanup(); }
  });
  it('rejects foreign UID roots before opening a handle', async () => {
    const f = await fixture(); const originalLstat = f.disk.lstat; const open = vi.spyOn(f.disk, 'open');
    f.disk.lstat = async (path, options) => {
      const info = await originalLstat(path, options); Object.defineProperty(info, 'uid', { value: info.uid + 1n }); return info;
    };
    try { await expect(f.open()).rejects.toThrow('Capacity source unavailable'); expect(open).not.toHaveBeenCalled(); }
    finally { await f.cleanup(); }
  });
  it('checks pinned handle identity independently of matching path metadata', async () => {
    const f = await fixture(); const originalOpen = f.disk.open;
    f.disk.open = async (path, flags) => {
      const handle = await originalOpen(path, flags); const actual = await handle.stat({ bigint: true });
      Object.defineProperty(actual, 'ino', { value: actual.ino + 1n });
      vi.spyOn(handle, 'stat').mockResolvedValue(actual); return handle;
    };
    try { await expect(f.open()).rejects.toThrow('Capacity source unavailable'); }
    finally { await f.cleanup(); }
  });
  it('retains failed startup close original and does not report a completed failed open', async () => {
    let handle: FileHandle | undefined; const attempted = deferred<void>();
    const f = await fixture({
      open: async (path, flags) => {
        handle = await nativeDisk.open(path, flags);
        vi.spyOn(handle, 'stat').mockRejectedValue(new Error('private-canary')); return handle;
      },
      close: async () => { attempted.resolve(); throw new Error('private-canary'); },
    });
    let settled = false; const opening = f.open(); void opening.then(() => { settled = true; }, () => { settled = true; });
    await attempted.promise; await Promise.resolve(); expect(settled).toBe(false);
    // The seam failed before native close; fixture cleanup does not retry adapter cleanup.
    await nativeDisk.close(handle!); await rm(f.root, { recursive: true, force: true });
  });
});
