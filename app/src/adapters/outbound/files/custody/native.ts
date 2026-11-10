import { constants } from 'node:fs';
import type { BigIntStats, BigIntStatsFs } from 'node:fs';
import { link, lstat, mkdir, open, realpath, statfs, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';

/** Internal native fault seam. Originals, including directory handles, belong to a job. */
export interface NativePort {
  open(path: string, flags: number, mode?: number): Promise<FileHandle>;
  lstat(path: string, options: { bigint: true }): Promise<BigIntStats>;
  realpath(path: string): Promise<string>;
  mkdir(path: string, options: { mode: number }): Promise<string | undefined>;
  link(source: string, destination: string): Promise<void>;
  unlink(path: string): Promise<void>;
  statfs(path: string, options: { bigint: true }): Promise<BigIntStatsFs>;
  close(handle: FileHandle): Promise<void>;
  sync(handle: FileHandle): Promise<void>;
  truncate(handle: FileHandle, length: number): Promise<void>;
  read(handle: FileHandle, bytes: Uint8Array, position: number): Promise<number>;
  write(handle: FileHandle, bytes: Uint8Array, position: number): Promise<number>;
}
export const nativePort: NativePort = {
  open, lstat, realpath, mkdir, link, unlink, statfs,
  close: handle => handle.close(),
  sync: handle => handle.sync(),
  truncate: (handle, length) => handle.truncate(length),
  read: async (handle, bytes, position) => (await handle.read(bytes, 0, bytes.byteLength, position)).bytesRead,
  write: async (handle, bytes, position) => (await handle.write(bytes, 0, bytes.byteLength, position)).bytesWritten,
};
export const readFlags = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
export const writeFlags = constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK;
export const createFlags = writeFlags | constants.O_CREAT | constants.O_EXCL;
export const directoryFlags = readFlags | constants.O_DIRECTORY;
