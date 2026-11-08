import { lstat, realpath } from 'node:fs/promises';
import type { BigIntStats } from 'node:fs';
import { dirname, isAbsolute, normalize, parse } from 'node:path';
import { ProviderError } from './types.js';

export interface NamedIdentity { readonly path: string; readonly stat: BigIntStats; readonly parents?: readonly NamedIdentity[] }
export function privatePath(path: unknown, maximumBytes = 1024, maximumParents = 32): string {
  if (typeof path !== 'string' || Buffer.byteLength(path) > maximumBytes || !isAbsolute(path)
    || normalize(path) !== path || path.split('/').length - 2 > maximumParents) throw new ProviderError('configuration');
  return path;
}
export function same(a: BigIntStats, b: BigIntStats): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs
    && a.ctimeNs === b.ctimeNs && a.mode === b.mode && a.nlink === b.nlink && a.uid === b.uid && a.gid === b.gid;
}
export function privateStat(stat: BigIntStats): void {
  if (process.getuid === undefined || stat.uid !== BigInt(process.getuid()) || (stat.mode & 0o077n) !== 0n) throw new ProviderError('io');
}
export async function ancestry(path: string): Promise<readonly NamedIdentity[]> {
  privatePath(path, 1200, 36);
  const names: string[] = [];
  let parent = dirname(path);
  while (parent !== parse(parent).root) { names.unshift(parent); parent = dirname(parent); }
  const identities: NamedIdentity[] = [];
  for (const name of names) {
    const stat = await lstat(name, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new ProviderError('io');
    identities.push({ path: name, stat });
  }
  if (await realpath(dirname(path)) !== dirname(path)) throw new ProviderError('io');
  return identities;
}
export async function recheckParents(parents: readonly NamedIdentity[]): Promise<void> {
  for (const parent of parents) {
    const stat = await lstat(parent.path, { bigint: true });
    // Directory times/sizes change for unrelated entries; identity/mode/owner must not.
    if (!stat.isDirectory() || stat.dev !== parent.stat.dev || stat.ino !== parent.stat.ino
      || stat.mode !== parent.stat.mode || stat.uid !== parent.stat.uid || stat.gid !== parent.stat.gid) throw new ProviderError('io');
  }
}
export async function pinRoot(path: string): Promise<NamedIdentity> {
  const parents = await ancestry(path);
  const stat = await lstat(path, { bigint: true });
  privateStat(stat);
  if (!stat.isDirectory() || await realpath(path) !== path) throw new ProviderError('configuration');
  return { path, stat, parents };
}
export async function checkRoot(root: NamedIdentity): Promise<void> {
  if (root.parents) await recheckParents(root.parents);
  const current = await pinRoot(root.path);
  if (current.stat.ino !== root.stat.ino || current.stat.dev !== root.stat.dev) throw new ProviderError('io');
}
