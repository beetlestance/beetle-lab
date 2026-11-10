import type { BigIntStats } from 'node:fs';
import { isAbsolute, normalize } from 'node:path';

/** Private exact directory facts, shared by stopped-control and output owners. */
export interface CollectionRootIdentity {
  readonly directory: string;
  readonly uid: number;
  readonly device: string;
  readonly inode: string;
  readonly modifiedNs: string;
  readonly changedNs: string;
}

function valid(condition: unknown): asserts condition {
  if (!condition) throw new TypeError('Invalid collection root identity');
}
function uint64(value: unknown): void {
  valid(typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value));
  valid(BigInt(value) <= 18_446_744_073_709_551_615n);
}
function nanoseconds(value: unknown): void {
  valid(typeof value === 'string' && value.length <= 32 && /^(0|-?[1-9][0-9]*)$/.test(value));
}
function directory(value: unknown): void {
  valid(typeof value === 'string');
  valid(value.length <= 4096);
  valid(isAbsolute(value) && normalize(value) === value);
  valid(!value.includes('\u0000') && new TextEncoder().encode(value).byteLength <= 4096);
}
/** Captures bounded stored scalars without invoking field accessors; performs no native IO. */
export function captureCollectionRootIdentity(input: unknown): Readonly<CollectionRootIdentity> {
  valid(input !== null && typeof input === 'object' && !Array.isArray(input));
  const names = ['directory', 'uid', 'device', 'inode', 'modifiedNs', 'changedNs'];
  valid(Reflect.ownKeys(input).length === names.length);
  const value: Record<string, unknown> = {};
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(input, name);
    valid(descriptor?.enumerable && 'value' in descriptor); value[name] = descriptor.value;
  }
  directory(value.directory);
  valid(typeof value.uid === 'number' && Number.isSafeInteger(value.uid) && value.uid >= 0 && value.uid <= 4_294_967_295);
  uint64(value.device); uint64(value.inode); nanoseconds(value.modifiedNs); nanoseconds(value.changedNs);
  return Object.freeze(value) as unknown as Readonly<CollectionRootIdentity>;
}

/** Formats already checked native facts; establishes no filesystem custody itself. */
export function snapshotRootIdentity(directory: string, uid: number,
  stat: Pick<BigIntStats, 'dev' | 'ino' | 'mtimeNs' | 'ctimeNs'>): Readonly<CollectionRootIdentity> {
  return Object.freeze({ directory, uid, device: stat.dev.toString(), inode: stat.ino.toString(),
    modifiedNs: stat.mtimeNs.toString(), changedNs: stat.ctimeNs.toString() });
}
