import { expect, it, vi, afterEach } from 'vitest';
import type { FileHandle } from 'node:fs/promises';
import { provisionFreshInstallation } from '../index.js';
import { fixture } from './fixtures.js';
import { native } from '../src/files.js';
const f = fixture();
afterEach(() => { vi.restoreAllMocks(); });

it('R1 preserves receipt cleanup classification, cause and global failed-owner fence', async () => {
  const e = await f.setup(); const other = await f.setup();
  const result = await provisionFreshInstallation(e.request, e.context);
  const original = native.open; let held: FileHandle | undefined;
  const cause = new Error('Synthetic receipt close failure');
  vi.spyOn(native, 'open').mockImplementation(async (...args) => {
    const handle = await original(...args);
    if (String(args[0]) === result.paths.receipt) { held = handle; vi.spyOn(handle, 'close').mockRejectedValue(cause); }
    return handle;
  });
  await expect(provisionFreshInstallation(e.request, e.context)).rejects.toMatchObject({ code: 'cleanup', cause });
  await expect(provisionFreshInstallation(other.request, other.context)).rejects.toMatchObject({ code: 'conflict' });
  vi.restoreAllMocks(); await held?.close();
});
