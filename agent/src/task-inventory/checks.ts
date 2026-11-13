import type { BigIntStats } from 'node:fs';
import { captureNativeDirectory, captureNativeFile, cleanupControl } from '../cleanup-control/index.js';
import type { CleanupEntry, NativeDirectoryFact } from '../cleanup-control/index.js';
import { OutputFailure } from '../collection/output/index.js';
export function requireInventory(condition: unknown): asserts condition { if (!condition) throw new OutputFailure('custody'); }
export function sameNative(a: NativeDirectoryFact, b: NativeDirectoryFact): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.uid === b.uid && a.gid === b.gid && a.mode === b.mode;
}
export function nativeFact(stat: BigIntStats): NativeDirectoryFact {
  return captureNativeDirectory({ dev: String(stat.dev), ino: String(stat.ino), uid: String(stat.uid), gid: String(stat.gid), mode: String(stat.mode) });
}
export function signature(stat: BigIntStats): string {
  return [stat.dev, stat.ino, stat.uid, stat.gid, stat.mode, stat.nlink, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
}
export function entry(path: string, stat: BigIntStats, root: NativeDirectoryFact): CleanupEntry {
  requireInventory(stat.dev.toString() === root.dev && stat.uid.toString() === root.uid && stat.gid.toString() === root.gid);
  const base = { dev: String(stat.dev), ino: String(stat.ino), uid: String(stat.uid), gid: String(stat.gid), mode: String(stat.mode) };
  if (stat.isDirectory()) {
    requireInventory((stat.mode & 0o7777n) === 0o700n); return { path, kind: 'directory', native: captureNativeDirectory(base) };
  }
  requireInventory(stat.isFile() && stat.nlink === 1n && [0o400n, 0o600n].includes(stat.mode & 0o7777n));
  return { path, kind: 'file', native: captureNativeFile({ ...base, bytes: String(stat.size), links: '1' }) };
}
export function component(raw: unknown, parent: string): string {
  requireInventory(Buffer.isBuffer(raw) && raw.length > 0 && raw.length <= cleanupControl.maximumPathBytes);
  let name: string;
  try { name = new TextDecoder('utf-8', { fatal: true }).decode(raw); } catch { throw new OutputFailure('custody'); }
  requireInventory(Buffer.from(name).equals(raw) && name !== '.' && name !== '..' && ![...name].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 || char === '/' || char === '\\'));
  const path = parent ? `${parent}/${name}` : name;
  if (Buffer.byteLength(path) > cleanupControl.maximumPathBytes || path.split('/').length > cleanupControl.maximumDepth) throw new OutputFailure('output_limit');
  return name;
}
