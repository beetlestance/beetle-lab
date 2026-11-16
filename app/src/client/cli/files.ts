import { constants } from 'node:fs';
import { open, lstat } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import type { BigIntStats } from 'node:fs';
import { dirname } from 'node:path';
import { ClientError } from './errors.js';
const failure = (): never => {throw new ClientError('io', 2);};
function regular(stat: BigIntStats, limit: number, privateFile: boolean): void {
  if (!stat.isFile() || stat.nlink !== 1n || stat.size < 1n || stat.size > BigInt(limit)) failure();
  if (privateFile && (stat.uid !== BigInt(process.getuid!()) || (stat.mode & 0o7777n) !== 0o600n)) failure();
}
function same(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}
/** Fixed-size read, stable opened inode and explicit EOF; no path/error reflection. */
export async function readFileBounded(path: string, limit: number, privateFile = false): Promise<string> {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await handle.stat({bigint: true}); regular(before, limit, privateFile);
    const buffer = Buffer.alloc(limit + 1); let offset = 0;
    for (let calls = 0; calls < limit + 1; calls++) {
      const read = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (!read.bytesRead) break; offset += read.bytesRead; if (offset > limit) failure();
    }
    const after = await handle.stat({bigint: true}); regular(after, limit, privateFile);
    if (!same(before, after) || offset !== Number(before.size)) failure();
    return new TextDecoder('utf-8', {fatal: true}).decode(buffer.subarray(0, offset));
  } catch {return failure();} finally {await handle?.close();}
}
async function privateDirectory(path: string) {
  const handle = await open(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat({bigint: true});
    if (stat.uid !== BigInt(process.getuid!()) || (stat.mode & 0o7777n) !== 0o700n) failure();
    return {handle, stat};
  } catch (cause) {await handle.close(); throw cause;}
}
async function writeAll(file: FileHandle, bytes: Uint8Array): Promise<void> {
  let offset = 0;
  for (let calls = 0; offset < bytes.length; calls++) {
    if (calls >= 4096) failure(); const wrote = await file.write(bytes, offset, bytes.length - offset, offset);
    if (wrote.bytesWritten < 1) failure(); offset += wrote.bytesWritten;
  }
}
async function assertDirectory(path: string, expected: BigIntStats): Promise<void> {
  const named = await open(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {const actual = await named.stat({bigint: true}); if (actual.dev !== expected.dev || actual.ino !== expected.ino) failure();} finally {await named.close();}
}
/** New private file only; a partial/unknown write is retained, never overwritten. */
export async function writeCredentials(path: string, text: string): Promise<void> {
  let parent: Awaited<ReturnType<typeof privateDirectory>> | undefined; let file: FileHandle | undefined; let failed = false;
  try {
    if (Buffer.byteLength(text) > 4096) failure(); parent = await privateDirectory(path);
    file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await writeAll(file, Buffer.from(text)); await file.sync();
    regular(await file.stat({bigint: true}), 4096, true); await parent.handle.sync(); await assertDirectory(path, parent.stat);
  } catch {failed = true;} finally {
    const closed = await Promise.allSettled([Promise.resolve().then(() => file?.close()), Promise.resolve().then(() => parent?.handle.close())]);
    failed ||= closed.some(result => result.status === 'rejected');
  }
  if (failed) throw new ClientError('io', 3);
}
async function assertAbsent(path: string): Promise<void> {
  try {await lstat(path);} catch (cause) {
    if (cause && typeof cause === 'object' && 'code' in cause && cause.code === 'ENOENT') return; throw cause;
  }
  failure();
}
/** Refuse known existing destinations before consuming a single-use startup token. */
export async function prepareCredentialDestination(path: string): Promise<void> {
  let parent;
  try {parent = await privateDirectory(path); await assertAbsent(path);} catch {failure();} finally {await parent?.handle.close();}
}
