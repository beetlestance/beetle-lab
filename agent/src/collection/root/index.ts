import type { BigIntStats } from 'node:fs';

/** Private exact directory facts, shared by stopped-control and output owners. */
export interface CollectionRootIdentity {
  readonly directory: string;
  readonly uid: number;
  readonly device: string;
  readonly inode: string;
  readonly modifiedNs: string;
  readonly changedNs: string;
}

/** Formats already checked native facts; establishes no filesystem custody itself. */
export function snapshotRootIdentity(directory: string, uid: number,
  stat: Pick<BigIntStats, 'dev' | 'ino' | 'mtimeNs' | 'ctimeNs'>): Readonly<CollectionRootIdentity> {
  return Object.freeze({ directory, uid, device: stat.dev.toString(), inode: stat.ino.toString(),
    modifiedNs: stat.mtimeNs.toString(), changedNs: stat.ctimeNs.toString() });
}
