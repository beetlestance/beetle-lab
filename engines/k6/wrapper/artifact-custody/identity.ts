import type { BigIntStats } from 'node:fs';
import { AttemptError } from '../failure/index.js';

export function same(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size
    && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}
export function regular(stat: BigIntStats, uid: number, bytes: number): void {
  if (!stat.isFile() || stat.nlink !== 1n || stat.uid !== BigInt(uid) || (stat.mode & 0o777n) !== 0o600n
    || stat.size !== BigInt(bytes)) throw new AttemptError('artifact');
}
export function directory(stat: BigIntStats, uid: number): void {
  if (!stat.isDirectory() || stat.uid !== BigInt(uid) || (stat.mode & 0o777n) !== 0o700n) throw new AttemptError('profile');
}
