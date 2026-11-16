import { mkdir, opendir, rename, rm, writeFile } from 'node:fs/promises';
import type { Dir } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, it, vi } from 'vitest';
import { scanOutput, scanOutputWithFiles } from '../../src/staging/output-scan.js';
import { scanFiles } from '../../src/staging/output-tree.js';
import { outputFixture, operation } from './output-fixtures.js';

const f = outputFixture();
function held<T>() {
  let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve };
}
it('bounds entries before allowing an incomplete aggregate to become known', async () => {
  const e = await f.prepared();
  for (let index = 0; index < 257; index++) await writeFile(join(e.directory, `file-${index}`), '', { mode: 0o600 });
  expect(await scanOutput(e.options.root, { ...e.request, outputBytes: 8_388_608 }, operation()))
    .toMatchObject({ kind: 'unknown', reason: 'bounds' });
});
it('bounds original filesystem calls including reserved directory closes', async () => {
  const e = await f.prepared();
  for (let index = 0; index < 230; index++) await mkdir(join(e.directory, `dir-${index}`), { mode: 0o700 });
  let calls = 0; const files = { ...scanFiles,
    stat: async (path: string) => { calls++; return scanFiles.stat(path); },
    canonical: async (path: string) => { calls++; return scanFiles.canonical(path); },
    space: async (path: string) => { calls++; return scanFiles.space(path); },
    directory: async (path: string) => {
      calls++; const dir = await scanFiles.directory(path);
      return { read: async () => { calls++; return dir.read(); }, close: async () => { calls++; await dir.close(); } } as unknown as Dir;
    } };
  expect(await scanOutputWithFiles(e.options.root, { ...e.request, outputBytes: 8_388_608 }, operation(), files))
    .toMatchObject({ kind: 'unknown', reason: 'bounds' });
  expect(calls).toBeLessThanOrEqual(2048);
});
it('retains both original scan slots after abort until held reads and closes settle', async () => {
  const e = await f.prepared(); const gate = held<null>(); const abort = new AbortController(); let reads = 0; let closes = 0;
  const files = { ...scanFiles, async directory(path: string) {
    const dir = await opendir(path, { bufferSize: 1 });
    return { read: () => { reads++; return gate.promise; }, close: async () => { closes++; await dir.close(); } } as unknown as Dir;
  } };
  const budget = { ...operation(), signal: abort.signal };
  const first = scanOutputWithFiles(e.options.root, e.request, budget, files);
  const second = scanOutputWithFiles(e.options.root, e.request, budget, files);
  try {
    await vi.waitFor(() => { expect(reads).toBe(2); }); abort.abort();
    expect(await scanOutput(e.options.root, e.request, operation())).toEqual({ kind: 'unknown', reason: 'busy' });
    expect(closes).toBe(0);
  } finally { gate.resolve(null); }
  expect(await first).toEqual({ kind: 'unknown', reason: 'cancelled' });
  expect(await second).toEqual({ kind: 'unknown', reason: 'cancelled' }); expect(closes).toBe(2);
  expect(await scanOutput(e.options.root, e.request, operation())).toMatchObject({ kind: 'known' });
});
it('adopts and closes a directory returned after its open was aborted', async () => {
  const e = await f.prepared(); const gate = held<void>(); const abort = new AbortController(); let opened = false; let closes = 0;
  const files = { ...scanFiles, async directory(path: string) {
    const dir = await opendir(path, { bufferSize: 1 }); opened = true; await gate.promise;
    return { read: () => dir.read(), close: async () => { closes++; await dir.close(); } } as unknown as Dir;
  } };
  const scanning = scanOutputWithFiles(e.options.root, e.request, { ...operation(), signal: abort.signal }, files);
  try { await vi.waitFor(() => { expect(opened).toBe(true); }); abort.abort(); expect(closes).toBe(0); }
  finally { gate.resolve(); }
  expect(await scanning).toEqual({ kind: 'unknown', reason: 'cancelled' }); expect(closes).toBe(1);
});
it('refuses a staged-root replacement even if a new output tree has the expected path and user', async () => {
  const e = await f.prepared(); const moved = `${e.rootPath}-scan-owned`; let replaced = false;
  const files = { ...scanFiles, async space(path: string) {
    const space = await scanFiles.space(path);
    if (!replaced) {
      replaced = true; await rename(e.rootPath, moved); await mkdir(e.rootPath, { mode: 0o700 });
      await mkdir(join(e.rootPath, relative(e.rootPath, e.directory)), { recursive: true, mode: 0o700 });
    }
    return space;
  } };
  try { expect(await scanOutputWithFiles(e.options.root, e.request, operation(), files)).toMatchObject({ kind: 'unknown', reason: 'custody' }); }
  finally { if (replaced) { await rm(e.rootPath, { recursive: true }); await rename(moved, e.rootPath); } }
});
// Last: a rejected original close deliberately quarantines both process-wide slots.
it('quarantines failed close owners rather than reusing their slots or closing twice', async () => {
  const e = await f.prepared(); let closes = 0;
  const files = { ...scanFiles, async directory(path: string) {
    const dir = await opendir(path, { bufferSize: 1 });
    return { read: () => dir.read(), close: async () => {
      closes++; await dir.close(); throw new Error('synthetic failed close response');
    } } as unknown as Dir;
  } };
  const results = await Promise.all([scanOutputWithFiles(e.options.root, e.request, operation(), files),
    scanOutputWithFiles(e.options.root, e.request, operation(), files)]);
  expect(results).toEqual([{ kind: 'unknown', reason: 'cleanup' }, { kind: 'unknown', reason: 'cleanup' }]);
  expect(closes).toBe(2);
  expect(await scanOutput(e.options.root, e.request, operation())).toEqual({ kind: 'unknown', reason: 'busy' });
});
