import type { BigIntStats } from 'node:fs';
import { dirname, isAbsolute, normalize } from 'node:path';
import { Custody, createFlags, directoryFlags, nativePort, pinRoot, privateStat, sameDirectory, sameFileOwner } from '../custody/index.js';
import type { Root } from '../custody/index.js';
import { fail } from './lease-errors.js';

export class LeaseFile {
  cleanupFailed = false;
  private root?: Root;
  private original?: BigIntStats;
  readonly custody = new Custody(nativePort, { freeSpaceReserveBytes: 0 });
  constructor(readonly path: string) {}
  async pin(create: boolean): Promise<void> {
    if (typeof this.path !== 'string' || !isAbsolute(this.path) || normalize(this.path) !== this.path
      || Buffer.byteLength(this.path) > 1024 || this.path.split('/').length > 32) fail('invalid_input');
    this.root = await pinRoot(nativePort, dirname(this.path)); await this.checkParent();
    if (create) {
      const file = await this.custody.open(this.path, createFlags, 0o600);
      this.original = await file.stat({ bigint: true }); this.valid(this.original);
      await nativePort.sync(file); await this.checkParent();
      const parent = await this.custody.open(this.root.path, directoryFlags);
      if (!sameDirectory(this.root.stat, await parent.stat({ bigint: true }))) fail('integrity');
      await nativePort.sync(parent);
      if (!await this.custody.close()) { this.cleanupFailed = true; fail('cleanup'); }
    } else {
      this.original = await nativePort.lstat(this.path, { bigint: true }); this.valid(this.original);
    }
    await this.check();
  }
  private valid(stat: BigIntStats): void {
    privateStat(stat, false);
    if (stat.nlink !== 1n || stat.size < 0n || stat.size > 65_536n) fail('integrity');
  }
  private async checkParent(): Promise<void> {
    if (!this.root) fail('integrity');
    for (const entry of [...this.root.ancestors, this.root]) {
      if (!sameDirectory(entry.stat, await nativePort.lstat(entry.path, { bigint: true }))) fail('integrity');
    }
  }
  async check(): Promise<void> {
    await this.checkParent();
    const current = await nativePort.lstat(this.path, { bigint: true }); this.valid(current);
    if (!this.original || !sameFileOwner(this.original, current)) fail('integrity');
    await this.checkParent();
  }
}
