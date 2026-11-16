import { recoveryPath } from '@beetle/contracts/recovery';
import { constants } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { lstat, mkdir, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, normalize } from 'node:path';
import { RecoveryError } from './types.js';
import type { Owned } from './types.js';
import type { RecoveryIO } from './io.js';
export const CHUNK = 65536;
export function regular(info: BigIntStats, maximum = Number.MAX_SAFE_INTEGER, privateFile = true): void {
  if (!info.isFile() || info.nlink !== 1n || info.uid !== BigInt(process.getuid!()) || (info.mode & (privateFile ? 0o077n : 0o022n))
    || info.size < 0n || info.size > BigInt(maximum)) throw new RecoveryError('integrity');
}
export function stable(info: BigIntStats): string {
  return [info.dev, info.ino, info.uid, info.gid, info.mode, info.size, info.mtimeNs, info.ctimeNs, info.nlink].join(':');
}
export async function directory(io: RecoveryIO, path: string): Promise<BigIntStats> {
  if (!isAbsolute(path) || normalize(path) !== path || await io.issue(() => realpath(path)) !== path) throw new RecoveryError('invalid_input');
  const info = await io.issue(() => lstat(path, {bigint: true}));
  if (!info.isDirectory() || info.uid !== BigInt(process.getuid!()) || (info.mode & 0o077n)) throw new RecoveryError('integrity'); return info;
}
export async function createDirectory(io: RecoveryIO, path: string): Promise<void> {
  if (!isAbsolute(path) || normalize(path) !== path) throw new RecoveryError('invalid_input');
  await directory(io, dirname(path)); await io.issue(() => mkdir(path, {mode: 0o700})); await directory(io, path); await syncDirectory(io, dirname(path));
}
export async function syncDirectory(io: RecoveryIO, path: string): Promise<void> {
  const file = await io.acquireFile(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {await io.issue(() => file.value.sync());} finally {await io.close(file);}
}
export async function write(io: RecoveryIO, file: Owned<FileHandle>, bytes: Uint8Array, position: number): Promise<number> {
  if (!(bytes instanceof Uint8Array) || bytes.length > CHUNK || !Number.isSafeInteger(position) || position < 0) throw new RecoveryError('invalid_input');
  let offset = 0;
  for (let calls = 0; offset < bytes.length; calls++) {
    if (calls >= 128) throw new RecoveryError('limit');
    const result = await io.issue(() => file.value.write(bytes, offset, bytes.length - offset, position + offset));
    if (!Number.isSafeInteger(result.bytesWritten) || result.bytesWritten < 1 || result.bytesWritten > bytes.length - offset) throw new RecoveryError('io');
    offset += result.bytesWritten;
  }
  return position + offset;
}
export async function hashFile(io: RecoveryIO, path: string, maximum: number): Promise<{bytes: number; sha256: string; native: BigIntStats}> {
  await directory(io, dirname(path));
  const file = await io.acquireFile(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let result: {bytes: number; sha256: string; native: BigIntStats};
  try {
    const before = await io.issue(() => file.value.stat({bigint: true})); regular(before, maximum);
    const buffer = new Uint8Array(CHUNK); const hash = createHash('sha256'); let position = 0;
    while (position < Number(before.size)) {
      const part = await io.issue(() => file.value.read(buffer, 0, Math.min(CHUNK, Number(before.size) - position), position));
      if (part.bytesRead < 1) throw new RecoveryError('integrity'); hash.update(buffer.subarray(0, part.bytesRead)); position += part.bytesRead;
    }
    const after = await io.issue(() => file.value.stat({bigint: true}));
    if (stable(before) !== stable(after)) throw new RecoveryError('integrity');
    result = {bytes: position, sha256: hash.digest('hex'), native: after};
  } finally {await io.close(file);}
  if (stable(result.native) !== stable(await io.issue(() => lstat(path, {bigint: true})))) throw new RecoveryError('integrity');
  await directory(io, dirname(path)); return result;
}
export async function copyFile(io: RecoveryIO, source: string, destination: string, maximum: number) {
  await directory(io, dirname(source)); await directory(io, dirname(destination));
  let original: BigIntStats | undefined;
  const input = await io.acquireFile(source, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await io.issue(() => input.value.stat({bigint: true})); regular(before, maximum, false); original = before;
    const output = await io.acquireFile(destination, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      const buffer = new Uint8Array(CHUNK); let position = 0;
      while (position < Number(before.size)) {
        const chunk = await io.issue(() => input.value.read(buffer, 0, Math.min(CHUNK, Number(before.size) - position), position));
        if (chunk.bytesRead < 1) throw new RecoveryError('integrity'); position = await write(io, output, buffer.subarray(0, chunk.bytesRead), position);
      }
      await io.issue(() => output.value.sync());
      if (stable(before) !== stable(await io.issue(() => input.value.stat({bigint: true})))) throw new RecoveryError('integrity');
    } finally {await io.close(output);}
  } finally {await io.close(input);}
  if (!original || stable(original) !== stable(await io.issue(() => lstat(source, {bigint: true})))) throw new RecoveryError('integrity');
  await directory(io, dirname(source));
  await syncDirectory(io, dirname(destination)); return hashFile(io, destination, maximum);
}
export function child(root: string, relative: string): string {
  if (!recoveryPath(relative)) throw new RecoveryError('invalid_input'); return join(root, relative);
}
