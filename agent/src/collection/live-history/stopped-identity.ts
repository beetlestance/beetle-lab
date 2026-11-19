import type { BigIntStats } from 'node:fs';
import { OutputFailure } from '../output/index.js';
import type { CollectionRootIdentity } from '../root/index.js';

export function exactRoot(expected: CollectionRootIdentity, stat: BigIntStats): void {
  if (!stat.isDirectory() || stat.uid !== BigInt(expected.uid) || (stat.mode & 0o7777n) !== 0o700n)
    throw new OutputFailure('custody');
  if (
    stat.dev !== BigInt(expected.device) ||
    stat.ino !== BigInt(expected.inode) ||
    stat.mtimeNs !== BigInt(expected.modifiedNs) ||
    stat.ctimeNs !== BigInt(expected.changedNs)
  )
    throw new OutputFailure('custody');
}

export function sameEntry(left: BigIntStats, right: BigIntStats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}
