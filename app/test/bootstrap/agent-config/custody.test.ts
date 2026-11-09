import { constants } from 'node:fs';
import { chmod, open, rename, unlink, writeFile } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAgentConfigurationLoader } from '../../../src/bootstrap/agent-config/loader.js';
import { nativeFiles } from '../../../src/bootstrap/agent-config/private-file.js';
import type { FileOperations } from '../../../src/bootstrap/agent-config/private-file.js';
import { deferred, fixture, installationId } from './fixture.js';

describe('original file operation custody', () => {
  let f: Awaited<ReturnType<typeof fixture>>;
  beforeEach(async () => { f = await fixture(); });
  afterEach(async () => { await f.cleanup(); });
  it.each(['open', 'read', 'close'] as const)('retains a delayed original %s and refuses concurrent intake', async kind => {
    const entered = deferred(); const release = deferred();
    const operations: FileOperations = { ...nativeFiles };
    let held = false;
    const hold = async () => { if (!held) { held = true; entered.resolve(); await release.promise; } };
    if (kind === 'open') operations.open = async (path, flags) => { await hold(); return nativeFiles.open(path, flags); };
    if (kind === 'read') operations.read = async (handle, bytes, position) => { await hold(); return nativeFiles.read(handle, bytes, position); };
    if (kind === 'close') operations.close = async handle => { await hold(); return nativeFiles.close(handle); };
    const load = createAgentConfigurationLoader(operations);
    let settled = false;
    const original = load(f.path, installationId).finally(() => { settled = true; });
    await entered.promise;
    await expect(load(f.path, installationId)).rejects.toThrow('Agent configuration rejected');
    expect(settled).toBe(false); release.resolve();
    expect((await original).configuration).toEqual(f.value);
  });
  it('closes the configuration before opening the token with no-follow/nonblocking flags', async () => {
    const order: string[] = [];
    const operations: FileOperations = { ...nativeFiles,
      open: async (path, flags) => {
        expect(flags & constants.O_NOFOLLOW).toBe(constants.O_NOFOLLOW);
        expect(flags & constants.O_NONBLOCK).toBe(constants.O_NONBLOCK);
        order.push(path === f.path ? 'config-open' : 'token-open'); return nativeFiles.open(path, flags);
      }, close: async handle => { await nativeFiles.close(handle); order.push('close'); } };
    await createAgentConfigurationLoader(operations)(f.path, installationId);
    expect(order).toEqual(['config-open', 'close', 'token-open', 'close']);
  });
  it.each(['config', 'token'])('retains a failed original %s close and permanently fences intake', async kind => {
    let owned: FileHandle | undefined; let calls = 0;
    const operations: FileOperations = { ...nativeFiles,
      close: async handle => {
        calls++;
        if (calls === (kind === 'config' ? 1 : 2)) { owned = handle; throw new Error('private-detail'); }
        return nativeFiles.close(handle);
      } };
    const load = createAgentConfigurationLoader(operations);
    try {
      await expect(load(f.path, installationId)).rejects.toThrow('Agent configuration rejected');
      expect(owned).toBeDefined(); expect((await owned!.stat()).isFile()).toBe(true);
      const count = calls;
      await expect(load(f.path, installationId)).rejects.toThrow('Agent configuration rejected');
      expect(calls).toBe(count); // No close retry or further file intake.
    } finally { await owned?.close(); } // Synthetic descriptor is still owned by this test seam.
  });
  it('waits for original close on a read failure and releases intake only after known close', async () => {
    const entered = deferred(); const release = deferred();
    const operations: FileOperations = { ...nativeFiles, read: async () => { throw new Error('private-detail'); },
      close: async handle => { entered.resolve(); await release.promise; await nativeFiles.close(handle); } };
    const load = createAgentConfigurationLoader(operations);
    let settled = false;
    const original = load(f.path, installationId).catch((error: unknown) => { settled = true; return error; });
    await entered.promise; expect(settled).toBe(false);
    await expect(load(f.path, installationId)).rejects.toThrow('Agent configuration rejected');
    release.resolve(); expect(await original).toBeInstanceOf(Error);
  });
  it.each(['replace', 'size', 'mode', 'unlink', 'rewrite'] as const)('rejects %s during original read and closes the actual handle', async mutation => {
    let changed = false; const close = vi.fn(nativeFiles.close);
    const operations: FileOperations = { ...nativeFiles, close,
      read: async (handle, bytes, position) => {
        const count = await nativeFiles.read(handle, bytes, position);
        if (!changed) {
          changed = true;
          if (mutation === 'replace') { const replacement = join(f.root, 'replacement'); await writeFile(replacement, JSON.stringify(f.value), { mode: 0o600 }); await rename(replacement, f.path); }
          if (mutation === 'size') await writeFile(f.path, '{}');
          if (mutation === 'mode') await chmod(f.path, 0o644);
          if (mutation === 'unlink') await unlink(f.path);
          if (mutation === 'rewrite') { const replacement = JSON.stringify({ ...f.value, storageAllocationBytes: 2000 }); await writeFile(f.path, replacement); }
        }
        return count;
      } };
    await expect(createAgentConfigurationLoader(operations)(f.path, installationId)).rejects.toThrow('Agent configuration rejected');
    expect(close).toHaveBeenCalledTimes(1); expect(close.mock.calls[0]![0].fd).toBe(-1);
  });
  it('bounds fragmented read calls and closes on exhaustion', async () => {
    const read = vi.fn(async (handle: FileHandle, bytes: Uint8Array, position: number) =>
      (await handle.read(bytes, 0, 1, position)).bytesRead);
    const close = vi.fn(nativeFiles.close);
    await expect(createAgentConfigurationLoader({ ...nativeFiles, read, close })(f.path, installationId)).rejects.toThrow('Agent configuration rejected');
    expect(read).toHaveBeenCalledTimes(64); expect(close).toHaveBeenCalledTimes(1);
  });
  it('rejects file mutation while its original close was pending', async () => {
    const close = vi.fn(async (handle: FileHandle) => { await nativeFiles.close(handle); await chmod(f.path, 0o644); });
    await expect(createAgentConfigurationLoader({ ...nativeFiles, close })(f.path, installationId)).rejects.toThrow('Agent configuration rejected');
    expect(close).toHaveBeenCalledTimes(1);
  });
  it.each([-1, 65_538, 0.5, Number.NaN, 0])('rejects invalid/short original read count %s', async count => {
    const close = vi.fn(nativeFiles.close);
    await expect(createAgentConfigurationLoader({ ...nativeFiles, close, read: async () => count })(f.path, installationId)).rejects.toThrow('Agent configuration rejected');
    expect(close).toHaveBeenCalledTimes(1);
  });
  it('checks opened UID metadata against the original owned path', async () => {
    const read = vi.fn(nativeFiles.read); const close = vi.fn(nativeFiles.close);
    const operations: FileOperations = { ...nativeFiles, read, close, open: async (path, flags) => {
      const handle = await nativeFiles.open(path, flags);
      const info = await handle.stat({ bigint: true });
      vi.spyOn(handle, 'stat').mockResolvedValue({ ...info, uid: info.uid + 1n });
      return handle;
    } };
    await expect(createAgentConfigurationLoader(operations)(f.path, installationId)).rejects.toThrow('Agent configuration rejected');
    expect(read).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledTimes(1);
  });
  it('rejects mismatched opened file identity before reading', async () => {
    const read = vi.fn(nativeFiles.read); const close = vi.fn(nativeFiles.close);
    const operations = { ...nativeFiles, read, close, open: () => open(f.tokenPath, constants.O_RDONLY) };
    await expect(createAgentConfigurationLoader(operations)(f.path, installationId)).rejects.toThrow('Agent configuration rejected');
    expect(read).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledTimes(1);
  });
});
