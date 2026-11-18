import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import type { BigIntStats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { ProvisionError } from '../types.js';

/** Private fault seam for tests; production always uses the native promises. */
export const upgradeNative = {
  open: fs.open,
  lstat: fs.lstat,
  mkdir: fs.mkdir,
  rename: fs.rename,
  opendir: fs.opendir,
  rm: fs.rm,
  unlink: fs.unlink,
  chmod: fs.chmod,
};
export interface Operation {
  readonly signal: AbortSignal;
  readonly deadline: number;
}
export function checkOperation(operation: Operation): void {
  if (operation.signal.aborted) throw new ProvisionError('cancelled');
  if (performance.now() >= operation.deadline) throw new ProvisionError('deadline');
}
export function unsafe(condition: unknown): asserts condition {
  if (!condition) throw new ProvisionError('unsafe_root');
}
export function absent(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
export async function stat(path: string): Promise<BigIntStats | undefined> {
  try {
    return await upgradeNative.lstat(path, { bigint: true });
  } catch (error) {
    if (absent(error)) return undefined;
    throw error;
  }
}
async function closing<T>(handle: FileHandle, work: () => Promise<T>): Promise<T> {
  let outcome: { readonly value: T } | { readonly error: unknown };
  try {
    outcome = { value: await work() };
  } catch (error) {
    outcome = { error };
  }
  try {
    await handle.close();
  } catch (cause) {
    // An uncertain close is surfaced, never retried.
    throw new ProvisionError('cleanup', { cause });
  }
  if ('error' in outcome) throw outcome.error;
  return outcome.value;
}
export async function syncDirectory(path: string): Promise<void> {
  const handle = await upgradeNative.open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  await closing(handle, () => handle.sync());
}
/** Private 0700 directory owned by this process; created when asked, never repaired. */
export async function privateDirectory(path: string, create: boolean): Promise<void> {
  let info = await stat(path);
  if (!info && create) {
    await upgradeNative.mkdir(path, { mode: 0o700 });
    await syncDirectory(dirname(path));
    info = await stat(path);
  }
  unsafe(info && info.isDirectory() && !info.isSymbolicLink());
  unsafe(info.uid === BigInt(process.getuid!()) && (info.mode & 0o777n) === 0o700n);
}
function privateFile(info: BigIntStats, maximum: number): void {
  unsafe(info.isFile() && info.nlink === 1n && info.uid === BigInt(process.getuid!()));
  unsafe((info.mode & 0o077n) === 0n && info.size <= BigInt(maximum));
}
export async function readPrivate(path: string, maximum: number): Promise<Uint8Array | undefined> {
  if (!(await stat(path))) return undefined;
  const handle = await upgradeNative.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  return closing(handle, async () => {
    const before = await handle.stat({ bigint: true });
    privateFile(before, maximum);
    const bytes = new Uint8Array(Number(before.size));
    let offset = 0;
    for (let count = 0; offset < bytes.length && count < 4096; count++) {
      const result = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (result.bytesRead === 0) break;
      offset += result.bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    unsafe(offset === bytes.length && after.size === before.size && after.mtimeNs === before.mtimeNs);
    return bytes;
  });
}
async function writeAll(handle: FileHandle, bytes: Uint8Array): Promise<void> {
  let offset = 0;
  for (let count = 0; offset < bytes.length && count < 4096; count++) {
    const result = await handle.write(bytes, offset, bytes.length - offset, offset);
    if (result.bytesWritten < 1) throw new ProvisionError('io');
    offset += result.bytesWritten;
  }
  if (offset !== bytes.length) throw new ProvisionError('io');
  await handle.sync();
}
/** Atomic private replacement: exclusive sibling, fsync, rename, directory fsync. */
export async function writePrivate(path: string, bytes: Uint8Array): Promise<void> {
  const next = path + '.next';
  if (await stat(next)) await upgradeNative.unlink(next);
  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;
  const handle = await upgradeNative.open(next, flags, 0o600);
  await closing(handle, () => writeAll(handle, bytes));
  await upgradeNative.rename(next, path);
  await syncDirectory(dirname(path));
}
/** Removes an operation-owned work directory only; callers pass fixed names below their own operation. */
export async function removeOwned(path: string): Promise<void> {
  await upgradeNative.rm(path, { recursive: true, force: true, maxRetries: 0 });
  await syncDirectory(dirname(path));
}
export interface CopiedFile {
  readonly size: number;
  readonly sha256: string;
}
/** Copies one regular single-link file with digest; source must not change during the copy. */
export async function copyFile(source: string, destination: string, operation: Operation): Promise<CopiedFile> {
  const input = await upgradeNative.open(source, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  return closing(input, async () => {
    const before = await input.stat({ bigint: true });
    unsafe(before.isFile() && before.nlink === 1n);
    const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;
    const output = await upgradeNative.open(destination, flags, 0o600);
    const copied = await closing(output, () => stream(input, output, operation));
    const after = await input.stat({ bigint: true });
    unsafe(after.size === before.size && after.mtimeNs === before.mtimeNs && BigInt(copied.size) === before.size);
    return copied;
  });
}
async function stream(input: FileHandle, output: FileHandle, operation: Operation): Promise<CopiedFile> {
  const hash = createHash('sha256');
  const buffer = new Uint8Array(65_536);
  let size = 0;
  for (;;) {
    checkOperation(operation);
    const read = await input.read(buffer, 0, buffer.length, size);
    if (read.bytesRead === 0) break;
    const chunk = buffer.subarray(0, read.bytesRead);
    hash.update(chunk);
    let written = 0;
    while (written < chunk.length) {
      const result = await output.write(chunk, written, chunk.length - written, size + written);
      if (result.bytesWritten < 1) throw new ProvisionError('io');
      written += result.bytesWritten;
    }
    size += read.bytesRead;
  }
  await output.sync();
  return { size, sha256: hash.digest('hex') };
}
export async function names(path: string, limit: number): Promise<string[]> {
  const directory = await upgradeNative.opendir(path);
  const result: string[] = [];
  try {
    for (let entry = await directory.read(); entry !== null; entry = await directory.read()) {
      if (result.length >= limit) throw new ProvisionError('upgrade_blocked');
      result.push(entry.name);
    }
  } finally {
    await directory.close();
  }
  return result.sort();
}
export const child = (root: string, relative: string): string => (relative ? join(root, relative) : root);
