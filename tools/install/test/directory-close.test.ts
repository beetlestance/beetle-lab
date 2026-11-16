import { expect, it, vi, afterEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { provisionFreshInstallation } from '../index.js';
import { fixture } from './fixtures.js';
import { native } from '../src/files.js';
const f = fixture();
afterEach(() => { vi.restoreAllMocks(); });
const json = async (path: string): Promise<Record<string, unknown>> => JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;

it('drains ordinary directory originals before ready receipt publication and retains failed close', async () => {
  const e = await f.setup(); const original = native.open; let held: FileHandle | undefined;
  vi.spyOn(native, 'open').mockImplementation(async (...args) => {
    const handle = await original(...args);
    if (String(args[0]) === e.root) { held = handle; vi.spyOn(handle, 'close').mockRejectedValue(new Error('private synthetic close failure')); }
    return handle;
  });
  const failure = await provisionFreshInstallation(e.request, e.context).catch(error => error as Error);
  expect(failure).toMatchObject({ code: 'cleanup', cause: expect.any(AggregateError) });
  expect((await json(join(e.root, 'installation.json'))).phase).toBe('initializing');
  await expect(provisionFreshInstallation(e.request, e.context)).rejects.toMatchObject({ code: 'conflict' });
  vi.restoreAllMocks(); await held?.close();
});
