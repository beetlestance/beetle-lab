import type { FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { checkRoots, privateStat, sameDirectory } from './identity.js';
import type { Identity, Root, Roots } from './identity.js';
import { errorCode, fail } from './errors.js';
import type { Custody } from './custody.js';
import { directoryFlags } from './native.js';

export interface Directory extends Identity { readonly handle: FileHandle }
export interface Location {
  readonly path: string; readonly parent: Directory; readonly reachable: boolean; readonly absentAncestor?: string;
}
export class Directories {
  private readonly opened = new Map<string, Directory>();
  constructor(readonly owner: Custody, private readonly roots: Roots) {}
  async check(): Promise<void> {
    this.owner.check(); await checkRoots(this.owner.port, this.roots);
    for (const entry of this.opened.values()) {
      const named = await this.owner.port.lstat(entry.path, { bigint: true });
      const opened = await entry.handle.stat({ bigint: true });
      if (!sameDirectory(entry.stat, named) || !sameDirectory(entry.stat, opened)) fail('integrity');
    }
    this.owner.check();
  }
  private async open(path: string): Promise<Directory> {
    const cached = this.opened.get(path); if (cached) return cached;
    await this.check();
    const stat = await this.owner.port.lstat(path, { bigint: true }); privateStat(stat, true);
    const handle = await this.owner.open(path, directoryFlags);
    if (!sameDirectory(stat, await handle.stat({ bigint: true }))) fail('integrity');
    const entry = { path, stat, handle }; this.opened.set(path, entry);
    await this.check(); return entry;
  }
  async location(root: Root, input: { readonly components: readonly string[]; readonly name: string }, create: boolean): Promise<Location> {
    let parent = await this.open(root.path);
    const path = join(root.path, ...input.components, input.name);
    for (const component of input.components) {
      const child = join(parent.path, component);
      await this.check();
      const exists = await this.exists(child);
      if (!exists && !create) return { path, parent, reachable: false, absentAncestor: child };
      if (!exists) {
        await this.reserve(0);
        try { await this.owner.port.mkdir(child, { mode: 0o700 }); }
        catch (error) { if (errorCode(error) !== 'EEXIST') throw error; }
        await this.check();
      }
      const directory = await this.open(child);
      // Also flush existing ancestors: a restarted job cannot know which mkdir persisted.
      if (create) { await this.sync(directory); await this.sync(parent); }
      parent = directory;
    }
    return { path, parent, reachable: true };
  }
  private async exists(path: string): Promise<boolean> {
    try { await this.owner.port.lstat(path, { bigint: true }); return true; }
    catch (error) { if (errorCode(error) === 'ENOENT') return false; throw error; }
  }
  async sync(directory: Directory): Promise<void> {
    await this.check(); await this.owner.port.sync(directory.handle); await this.check();
  }
  async reserve(bytes: number): Promise<void> {
    const reserve = this.owner.context.freeSpaceReserveBytes;
    if (!Number.isSafeInteger(reserve) || reserve < 0 || !Number.isSafeInteger(bytes) || bytes < 0) fail('invalid_input');
    await this.check();
    const stat = await this.owner.port.statfs(this.roots.stage.path, { bigint: true });
    if (stat.bavail < 0n || stat.bsize <= 0n || stat.bavail * stat.bsize < BigInt(reserve) + BigInt(bytes)) fail('capacity_unavailable');
    await this.check();
  }
}
