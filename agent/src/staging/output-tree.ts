import { lstat, realpath, opendir, statfs } from 'node:fs/promises';
import type { BigIntStats, BigIntStatsFs, Dir } from 'node:fs';
import { join, relative } from 'node:path';
import { checkRoot } from './root.js';
import { ScanFailure, ScanLimit } from './output-budget.js';
import type { ScanBoundary } from './output-budget.js';
import type { OutputAuthority } from './output-authority.js';

export interface ScanFiles {
  stat(path: string): Promise<BigIntStats>;
  canonical(path: string): Promise<string>;
  directory(path: string): Promise<Dir>;
  space(path: string): Promise<BigIntStatsFs>;
}
export const scanFiles: ScanFiles = { stat: path => lstat(path, { bigint: true }), canonical: realpath,
  directory: path => opendir(path, { bufferSize: 1 }), space: path => statfs(path, { bigint: true }) };
interface Measure { logical: bigint; allocated: bigint; charged: bigint }
function measure(stat: BigIntStats): Measure {
  if (stat.size < 0n || stat.blocks < 0n) throw new ScanFailure('io');
  const allocated = stat.blocks * 512n;
  return { logical: stat.size, allocated, charged: stat.size > allocated ? stat.size : allocated };
}
const maximum = (left: bigint, right: bigint) => left > right ? left : right;
export class OutputTree {
  private entries = 0;
  private readonly seen = new Set<string>();
  private readonly handles = new Map<Dir, Promise<void> | null>();
  private readonly totals: Measure = { logical: 0n, allocated: 0n, charged: 0n };
  constructor(readonly authority: OutputAuthority, readonly boundary: ScanBoundary, private readonly files: ScanFiles) {}

  async read(): Promise<{ logicalBytes: number; allocatedBytes: number; chargedBytes: number; freeBytes: number }> {
    await checkRoot(this.authority.identity, this.boundary);
    const before = await this.space();
    await this.visit(this.authority.directory, 0);
    const after = await this.space();
    await checkRoot(this.authority.identity, this.boundary); this.boundary.check();
    return { logicalBytes: Number(this.totals.logical), allocatedBytes: Number(this.totals.allocated),
      chargedBytes: Number(this.totals.charged), freeBytes: Math.min(before, after) };
  }
  private async space(): Promise<number> {
    const stat = await this.boundary.wait(() => this.files.space(this.authority.identity.configuration.stagingRoot));
    if (stat.bsize <= 0n || stat.bavail < 0n) throw new ScanFailure('io');
    const bytes = stat.bavail * stat.bsize;
    if (bytes > BigInt(Number.MAX_SAFE_INTEGER)) throw new ScanFailure('bounds');
    if (bytes <= BigInt(this.authority.minimumFreeBytes)) throw new ScanLimit('disk');
    return Number(bytes);
  }
  private custody(stat: BigIntStats, directory: boolean): void {
    const owner = this.authority.identity;
    if (stat.dev !== BigInt(owner.dev) || stat.uid !== BigInt(owner.uid) || stat.gid !== BigInt(owner.gid)) throw new ScanFailure('custody');
    if (directory ? !stat.isDirectory() : !stat.isFile()) throw new ScanFailure('custody');
    const mode = directory ? 0o700n : 0o600n;
    if ((stat.mode & 0o7777n) !== mode || !directory && stat.nlink !== 1n) throw new ScanFailure('custody');
  }
  private account(stat: BigIntStats): Measure {
    const id = `${stat.dev}:${stat.ino}`;
    if (this.seen.has(id)) throw new ScanFailure(stat.isFile() ? 'io' : 'custody');
    this.seen.add(id); const value = measure(stat);
    this.add(value); return value;
  }
  private add(value: Measure): void {
    this.totals.logical += value.logical; this.totals.allocated += value.allocated; this.totals.charged += value.charged;
    if (this.totals.charged > this.authority.outputBytes) throw new ScanLimit('output');
  }
  private async pinned(path: string, prior: BigIntStats, directory: boolean): Promise<BigIntStats> {
    const current = await this.boundary.wait(() => this.files.stat(path)); this.custody(current, directory);
    if (current.dev !== prior.dev || current.ino !== prior.ino) throw new ScanFailure(directory ? 'custody' : 'io');
    return current;
  }
  private grow(initial: Measure, stat: BigIntStats): void {
    const now = measure(stat);
    const logical = maximum(initial.logical, now.logical); const allocated = maximum(initial.allocated, now.allocated);
    const charged = maximum(logical, allocated);
    this.add({ logical: logical - initial.logical, allocated: allocated - initial.allocated, charged: charged - initial.charged });
  }
  private async canonical(path: string): Promise<void> {
    if (await this.boundary.wait(() => this.files.canonical(path)) !== path) throw new ScanFailure('custody');
  }
  private async visit(path: string, depth: number): Promise<void> {
    if (++this.entries > 256 || relative(this.authority.directory, path).length > 512) throw new ScanFailure('bounds');
    const stat = await this.boundary.wait(() => this.files.stat(path));
    if (stat.isDirectory()) { await this.directory(path, depth, stat); return; }
    this.custody(stat, false); const initial = this.account(stat);
    this.grow(initial, await this.pinned(path, stat, false));
  }
  private async directory(path: string, depth: number, stat: BigIntStats): Promise<void> {
    if (depth >= 8) throw new ScanFailure('bounds');
    this.custody(stat, true); await this.canonical(path); const initial = this.account(stat);
    this.boundary.reserveClose();
    const dir = await this.boundary.wait(() => this.files.directory(path).then(handle => {
      this.handles.set(handle, null); return handle;
    }));
    await this.pinned(path, stat, true); await this.canonical(path);
    while (true) {
      const entry = await this.boundary.wait(() => dir.read()); if (entry === null) break;
      if (!/^[A-Za-z0-9_.-]{1,255}$/u.test(entry.name) || entry.name === '.' || entry.name === '..') throw new ScanFailure('custody');
      await this.visit(join(path, entry.name), depth + 1);
    }
    await this.close(dir);
    this.grow(initial, await this.pinned(path, stat, true)); await this.canonical(path);
  }
  private close(dir: Dir): Promise<void> {
    let original = this.handles.get(dir);
    if (!original) { original = Promise.resolve().then(() => dir.close()); this.handles.set(dir, original); }
    return original;
  }
  async drain(): Promise<boolean> {
    await this.boundary.drain();
    const results = await Promise.allSettled([...this.handles.keys()].map(dir => this.close(dir)));
    return results.every(result => result.status === 'fulfilled');
  }
}
