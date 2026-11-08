import { expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { FileLease, nativePort } from '../../src/providers/lease.js';
import { openInstalledProviders } from '../../src/providers/service.js';

it('retains and rejects a failed native stream close without retrying its original', async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'stream-cleanup-owned-'));
  const organizationId = '11111111-1111-4111-8111-111111111111';
  const workspaceId = '22222222-2222-4222-8222-222222222222';
  const id = '33333333-3333-4333-8333-333333333333';
  const value = new Uint8Array(70_000);
  const sha256 = createHash('sha256').update(value).digest('hex');
  const directory = join(root, organizationId, workspaceId, id);
  await mkdir(directory, { mode: 0o700, recursive: true });
  const path = join(directory, sha256); await writeFile(path, value, { mode: 0o600 });
  const service = await openInstalledProviders({ configuration: { inputRoot: root, secretBindings: [] } });
  let closes = 0;
  const close = vi.spyOn(nativePort, 'close').mockImplementation(async handle => {
    closes++; await handle.close(); throw new Error('synthetic close failure');
  });
  try {
    const iterator = (await service.input({ authority: { organizationId, workspaceId, attemptId: id,
      generation: 1, installationId: id, intentDigest: 'a'.repeat(64) }, input: { id, sha256, bytes: value.length },
      signal: new AbortController().signal }))[Symbol.asyncIterator]();
    await iterator.next();
    const returned = iterator.return?.();
    await expect(returned).rejects.toMatchObject({ reason: 'cleanup' });
    expect(iterator.return?.()).toBe(returned);
    await expect(service.close()).rejects.toMatchObject({ reason: 'cleanup' });
    expect(closes).toBe(1);
    const remaining = FileLease.acquire(path);
    expect(() => FileLease.acquire(path)).toThrow('Installed provider busy');
    await remaining.close();
  } finally { close.mockRestore(); await rm(root, { recursive: true, force: true }); }
});
