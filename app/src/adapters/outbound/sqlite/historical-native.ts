import { lstatSync } from 'node:fs';
import { StorageError } from './protocol.js';
/** The retained read-only connection must open the exact attested native file. */
export function checkHistoricalNative(path: string, expected: string | undefined): void {
  if (expected === undefined) return;
  const info = lstatSync(path, {bigint: true});
  const identity = [info.dev, info.ino, info.uid, info.gid, info.mode, info.size, info.mtimeNs, info.ctimeNs, info.nlink].join(':');
  if (!info.isFile() || info.nlink !== 1n || info.uid !== BigInt(process.getuid!()) || (info.mode & 0o777n) !== 0o400n || identity !== expected) throw new StorageError('unavailable');
}
export function captureHistoricalIdentity(readOnly: unknown, identity: unknown): void {
  if (identity === undefined) return;
  if (readOnly !== true || typeof identity !== 'string' || !/^-?\d{1,30}(:-?\d{1,30}){8}$/.test(identity)) throw new StorageError('invalid_input');
}
