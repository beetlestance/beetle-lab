import { statfs, mkdir, rename, rm } from 'node:fs/promises';
import type * as Fs from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { readRootSpace } from '../../src/staging/index.js';
import type { VerifiedRoot } from '../../src/staging/index.js';
import { fixture, operation } from './fixtures.js';

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof Fs>();
  return { ...actual, statfs: vi.fn(actual.statfs) };
});
const f = fixture();
const mocked = vi.mocked(statfs);
const space = (bavail: bigint, bsize = 4096n) => ({ type: 1n, bsize, frsize: bsize, blocks: 100n, bfree: 99n, bavail, files: 100n, ffree: 50n });
afterEach(() => { mocked.mockClear(); });

it('uses available nonroot blocks, including known zero, without exposing root paths', async () => {
  const e = await f.environment(false);
  mocked.mockResolvedValueOnce(space(2n));
  expect(await readRootSpace(e.options.root, operation())).toEqual({ ok: true,
    value: { expectedDaemonId: e.configuration.expectedDaemonId, availableBytes: 8192 } });
  mocked.mockResolvedValueOnce(space(0n));
  expect(await readRootSpace(e.options.root, operation())).toMatchObject({ ok: true, value: { availableBytes: 0 } });
});
it.each([space(-1n), space(1n, 0n), space(BigInt(Number.MAX_SAFE_INTEGER) + 1n, 1n)])(
  'rejects invalid or unsafe bigint filesystem totals %#', async value => {
    const e = await f.environment(false); mocked.mockResolvedValueOnce(value);
    expect(await readRootSpace(e.options.root, operation())).toEqual({ ok: false, reason: 'io' });
  });
it('rejects forged roots and observed canonical root replacement', async () => {
  expect(await readRootSpace({} as VerifiedRoot, operation())).toEqual({ ok: false, reason: 'installation' });
  const e = await f.environment(false); const moved = `${e.rootPath}-owned-moved`;
  await rename(e.rootPath, moved); await mkdir(e.rootPath, { mode: 0o700 });
  try { expect(await readRootSpace(e.options.root, operation())).toEqual({ ok: false, reason: 'installation' }); }
  finally { await rm(e.rootPath, { recursive: true }); await rename(moved, e.rootPath); }
});
it('retains an original statfs promise after abort and refuses a late known result', async () => {
  const e = await f.environment(false); const abort = new AbortController();
  let resolve!: (value: ReturnType<typeof space>) => void;
  const held = new Promise<ReturnType<typeof space>>(done => { resolve = done; });
  mocked.mockReturnValueOnce(held);
  const reading = readRootSpace(e.options.root, { ...operation(), signal: abort.signal });
  await vi.waitFor(() => { expect(mocked).toHaveBeenCalledOnce(); });
  let settled = false; void reading.then(() => { settled = true; }); abort.abort();
  await Promise.resolve(); expect(settled).toBe(false);
  resolve(space(1n)); expect(await reading).toEqual({ ok: false, reason: 'cancelled' });
});
