import type { BigIntStats } from 'node:fs';
import { dirname, isAbsolute, normalize, parse } from 'node:path';
import { fail } from './errors.js';
import type { NativePort } from './native.js';

export interface Identity { readonly path: string; readonly stat: BigIntStats }
export interface Root extends Identity { readonly ancestors: readonly Identity[] }
export interface Roots { readonly stage: Root; readonly published: Root }
export function sameFileOwner(a: BigIntStats, b: BigIntStats): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.mode === b.mode && a.uid === b.uid && a.gid === b.gid;
}
export function same(a: BigIntStats, b: BigIntStats): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.mode === b.mode && a.uid === b.uid
    && a.gid === b.gid && a.nlink === b.nlink && a.size === b.size
    && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}
export function sameDirectory(a: BigIntStats, b: BigIntStats): boolean {
  return b.isDirectory() && a.dev === b.dev && a.ino === b.ino && a.mode === b.mode
    && a.uid === b.uid && a.gid === b.gid;
}
export function privateStat(stat: BigIntStats, directory: boolean): void {
  if (!process.getuid || stat.uid !== BigInt(process.getuid())) fail('integrity');
  const mode = directory ? 0o700n : 0o600n;
  if ((stat.mode & 0o7777n) !== mode) fail('integrity');
  if (directory ? !stat.isDirectory() : !stat.isFile()) fail('integrity');
}
function validPath(path: string): void {
  if (typeof path !== 'string' || !isAbsolute(path) || normalize(path) !== path
    || Buffer.byteLength(path) > 1024 || path.split('/').length > 32) fail('invalid_input');
}
async function pinRoot(port: NativePort, path: string): Promise<Root> {
  validPath(path);
  const paths = [parse(path).root];
  let parent = dirname(path);
  while (parent !== parse(parent).root) { paths.splice(1, 0, parent); parent = dirname(parent); }
  const ancestors: Identity[] = [];
  for (const name of paths) {
    const stat = await port.lstat(name, { bigint: true });
    if (!stat.isDirectory()) fail('integrity');
    ancestors.push({ path: name, stat });
  }
  if (await port.realpath(path) !== path) fail('invalid_input');
  const stat = await port.lstat(path, { bigint: true }); privateStat(stat, true);
  return { path, stat, ancestors };
}
export async function pinRoots(port: NativePort, stagingRoot: string, publishedRoot: string): Promise<Roots> {
  validPath(stagingRoot); validPath(publishedRoot);
  if (stagingRoot === publishedRoot || dirname(stagingRoot) !== dirname(publishedRoot)) fail('invalid_input');
  if (stagingRoot === dirname(publishedRoot) || publishedRoot === dirname(stagingRoot)) fail('invalid_input');
  const stage = await pinRoot(port, stagingRoot);
  const published = await pinRoot(port, publishedRoot);
  if (stage.stat.dev !== published.stat.dev || stage.stat.ino === published.stat.ino) fail('invalid_input');
  const roots = { stage, published }; await checkRoots(port, roots); return roots;
}
export async function checkRoots(port: NativePort, roots: Roots): Promise<void> {
  for (const root of [roots.stage, roots.published]) {
    for (const entry of [...root.ancestors, root]) {
      if (!sameDirectory(entry.stat, await port.lstat(entry.path, { bigint: true }))) fail('integrity');
    }
  }
}
