import { constants } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize } from 'node:path';

export class InputDirectoryError extends Error {
  constructor() { super('Input storage initialization failed'); this.name = 'InputDirectoryError'; }
}
// One installation initializes per process. A failed close retains this owner
// and its handle; another startup cannot replace unknown native custody.
let initializing = false;
let stranded: FileHandle | undefined;
function privateDirectory(info: BigIntStats): void {
  if (!info.isDirectory() || process.getuid === undefined || info.uid !== BigInt(process.getuid())
    || (info.mode & 0o7777n) !== 0o700n) throw new InputDirectoryError();
}
function sameDirectory(a: BigIntStats, b: BigIntStats): void {
  privateDirectory(b);
  if (a.dev !== b.dev || a.ino !== b.ino || a.uid !== b.uid || a.gid !== b.gid || a.mode !== b.mode) throw new InputDirectoryError();
}
async function flushDirectory(path: string, expected: BigIntStats): Promise<void> {
  sameDirectory(expected, await lstat(path, { bigint: true }));
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    sameDirectory(expected, await handle.stat({ bigint: true }));
    await handle.sync(); sameDirectory(expected, await lstat(path, { bigint: true }));
  } finally {
    try { await handle.close(); }
    catch {
      stranded = handle;
      await new Promise<never>(() => { /* Unknown close never proves drainage. */ });
    }
  }
}
async function ensure(path: string): Promise<void> {
  const parent = dirname(path); const before = await lstat(parent, { bigint: true }); privateDirectory(before);
  if (await realpath(parent) !== parent) throw new InputDirectoryError();
  try { await mkdir(path, { mode: 0o700 }); }
  catch (error) {
    if (!(error !== null && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) throw error;
  }
  const child = await lstat(path, { bigint: true }); privateDirectory(child);
  if (await realpath(path) !== path) throw new InputDirectoryError();
  await flushDirectory(path, child); await flushDirectory(parent, before);
}
/** Installation-owned fixed roots only; never an HTTP-supplied path.
 * Each new child and parent is flushed before the application can acknowledge files.
 */
export async function initializeInputRoots(directory: string): Promise<{ stagingRoot: string; publishedRoot: string }> {
  if (initializing || stranded) throw new InputDirectoryError();
  initializing = true;
  try {
    if (!isAbsolute(directory) || normalize(directory) !== directory) throw new InputDirectoryError();
    const stagingRoot = join(directory, 'staging'); const publishedRoot = join(directory, 'published');
    // Match the native adapter's public path bounds before creating anything.
    for (const path of [stagingRoot, publishedRoot]) {
      if (Buffer.byteLength(path) > 1024 || path.split('/').length > 32) throw new InputDirectoryError();
    }
    await ensure(directory);
    await ensure(stagingRoot); await ensure(publishedRoot);
    return Object.freeze({ stagingRoot, publishedRoot });
  } catch { throw new InputDirectoryError(); }
  finally { if (!stranded) initializing = false; }
}
