import { expect, it, vi, afterEach } from 'vitest';
import { writeFile } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './fixtures.js';
import { native, readRequest } from '../src/files.js';
const f = fixture();
afterEach(() => { vi.restoreAllMocks(); });
it('R1 fences later CLI request-file IO permanently after failed original close', async () => {
  const e = await f.setup(); const path = join(e.root, 'request.json');
  await writeFile(path, '{}', { mode: 0o600 });
  const original = native.open; let held: FileHandle | undefined;
  const cause = new Error('Synthetic private request close failure');
  const opened = vi.spyOn(native, 'open').mockImplementation(async (...args) => {
    const handle = await original(...args); held = handle;
    vi.spyOn(handle, 'close').mockRejectedValue(cause); return handle;
  });
  await expect(readRequest(path, e.context)).rejects.toMatchObject({ code: 'cleanup', cause });
  expect(opened).toHaveBeenCalledOnce();
  await expect(readRequest(path, e.context)).rejects.toMatchObject({ code: 'cleanup' });
  expect(opened).toHaveBeenCalledOnce();
  vi.restoreAllMocks(); await held?.close();
});
