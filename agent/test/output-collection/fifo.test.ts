import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fixture, tracking } from './fixture.js';

const execute = promisify(execFile);
async function fifo(path: string): Promise<void> {
  await execute('python3', ['-c', 'import os,sys; os.mkfifo(sys.argv[1],0o600)', path]);
}
describe('FIFO custody', () => {
  const f = fixture();
  it('rejects an actual task-owned FIFO before file open', async () => {
    const artifact = await f.artifact('pipe', 'data'); await unlink(f.path('pipe')); await fifo(f.path('pipe'));
    const result = f.result([artifact]); await f.write(result); const t = tracking();
    expect(await f.collect(f.options(result), t.ports).result).toEqual({ ok: false, reason: 'custody' });
    expect(t.opened.filter(path => path.endsWith('/pipe'))).toHaveLength(0); expect(t.closed.length).toBe(t.opened.length);
  });
  it('opens a raced FIFO nonblocking, rejects its descriptor, and closes it', async () => {
    const artifact = await f.artifact('pipe', 'data'); const result = f.result([artifact]); await f.write(result); const t = tracking();
    const ports = { ...t.ports, open: async (...args: Parameters<typeof t.ports.open>) => {
      if (String(args[0]) === f.path('pipe')) {
        expect(Number(args[1]) & constants.O_NONBLOCK).not.toBe(0);
        await unlink(f.path('pipe')); await fifo(f.path('pipe'));
      }
      return t.ports.open(...args);
    } };
    expect(await f.collect(f.options(result), ports).result).toEqual({ ok: false, reason: 'custody' });
    expect(t.opened.filter(path => path.endsWith('/pipe'))).toHaveLength(1); expect(t.closed.length).toBe(t.opened.length);
  });
});
