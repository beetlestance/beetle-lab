import { constants, type Stats } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { JournalError } from './errors.js';
import type { Operation } from './budget.js';

export interface JournalFile {
  stat(): Promise<Stats>;
  sync(): Promise<void>;
  close(): Promise<void>;
  write(buffer: Buffer, offset: number, length: number, position: number): Promise<{ bytesWritten: number }>;
  read(buffer: Buffer, offset: number, length: number, position: number): Promise<{ bytesRead: number }>;
}
/** Trusted host adapter, injectable only for deterministic filesystem fault tests. */
export interface JournalIo {
  lstat(path: string): Promise<Stats>;
  realpath(path: string): Promise<string>;
  open(path: string, flags: number, mode?: number): Promise<JournalFile>;
}
export const nodeJournalIo: JournalIo = { lstat, realpath, open };

export async function directoryPath(directory: string, io: JournalIo, operation: Operation): Promise<string> {
  if (typeof directory !== 'string' || !isAbsolute(directory) || resolve(directory) !== directory) {
    throw new JournalError('untrusted_directory');
  }
  const actual = await io.realpath(directory); operation.check();
  const stat = await io.lstat(directory); operation.check();
  if (actual !== directory || !stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o022) !== 0 ||
      (process.getuid && stat.uid !== process.getuid())) throw new JournalError('untrusted_directory');
  return join(directory, 'control.ndjson');
}

export async function assertFile(file: JournalFile, operation: Operation): Promise<Stats> {
  const stat = await file.stat(); operation.check();
  if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600 ||
      (process.getuid && stat.uid !== process.getuid())) throw new JournalError('unsafe_file');
  return stat;
}

export const freshFlags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL |
  constants.O_NOFOLLOW | constants.O_NONBLOCK;
export const readFlags = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
export const directoryFlags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
