import { constants } from 'node:fs';
import { chmod, link, lstat, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { RecoveryIO } from './io.js';
import { copyFile, hashFile, regular, syncDirectory } from './files.js';
import { RecoveryError } from './types.js';
interface ExpectedFile {readonly bytes: number; readonly sha256: string}
async function existing(io: RecoveryIO, path: string) {
  try {return await io.issue(() => lstat(path, {bigint: true}));}
  catch (error) {if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null; throw error;}
}
/** Exact claimed work namespace only. O_EXCL + link publication never overwrites data. */
export async function publishCopy(io: RecoveryIO, source: string, destination: string, temporary: string, expected: ExpectedFile): Promise<void> {
  const published = await existing(io, destination); const partial = await existing(io, temporary);
  if (published) {
    if (partial) {
      if (!partial.isFile() || partial.nlink !== 2n || partial.dev !== published.dev || partial.ino !== published.ino) throw new RecoveryError('integrity');
      await io.issue(() => unlink(temporary)); await syncDirectory(io, dirname(temporary));
    }
    await match(io, destination, expected); return;
  }
  if (partial) {regular(partial, expected.bytes); await io.issue(() => unlink(temporary)); await syncDirectory(io, dirname(temporary));}
  const result = await copyFile(io, source, temporary, expected.bytes);
  if (result.bytes !== expected.bytes || result.sha256 !== expected.sha256) throw new RecoveryError('integrity');
  await io.issue(() => link(temporary, destination)); await syncDirectory(io, dirname(destination));
  await io.issue(() => unlink(temporary)); await syncDirectory(io, dirname(temporary));
  await match(io, destination, expected);
}
async function match(io: RecoveryIO, path: string, expected: ExpectedFile): Promise<void> {
  const observed = await hashFile(io, path, expected.bytes);
  if (observed.bytes !== expected.bytes || observed.sha256 !== expected.sha256) throw new RecoveryError('integrity');
  await io.issue(() => chmod(path, 0o400));
  const file = await io.acquireFile(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {await io.issue(() => file.value.sync());} finally {await io.close(file);}
  await syncDirectory(io, dirname(path));
}
