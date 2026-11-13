import { constants } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { cleanupControl } from '../cleanup-control/index.js';
import type { CleanupEntry, NativeDirectoryFact } from '../cleanup-control/index.js';
import { OutputFailure } from '../collection/output/index.js';
import type { OutputIO } from '../collection/output/index.js';
import type { InventoryPorts } from './ports.js';
import { InventoryRoot } from './installation.js';
import type { InventoryInstallation } from './installation.js';
import { component, entry, nativeFact, requireInventory, sameNative, signature } from './checks.js';
interface Observed { readonly path: string; readonly stat: BigIntStats; readonly entry: CleanupEntry }
export class InventoryTree {
  private readonly observed: Observed[] = [];
  private readonly identities = new Set<string>();
  private mountId: string | undefined;
  private readonly installationRoot: InventoryRoot;
  constructor(private readonly directory: string, private readonly root: NativeDirectoryFact,
    private readonly io: OutputIO, private readonly ports: InventoryPorts, installation: InventoryInstallation) {
    requireInventory(directory.startsWith(`${installation.directory}/`) && !directory.slice(installation.directory.length + 1).includes('/'));
    this.installationRoot = new InventoryRoot(installation, io, ports);
  }
  async read(): Promise<readonly CleanupEntry[]> {
    requireInventory(this.ports.platform === 'linux');
    requireInventory(await this.io.io(() => this.ports.realpath(this.directory)) === this.directory);
    const installed = await this.installationRoot.open();
    this.mountId = await this.io.io(() => this.ports.mount(installed, this.io));
    const name = this.directory.slice(this.directory.lastIndexOf('/') + 1);
    const handle = await this.open(this.ports.child(installed, name), true);
    try { await this.visit(handle, '', this.directory); }
    finally { await this.io.closeHandles([handle, installed]); }
    await this.namedCheck(); return this.observed.map(row => row.entry).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  }
  private async open(path: string, directory: boolean): Promise<FileHandle> {
    const flags = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK | (directory ? constants.O_DIRECTORY : 0);
    return this.io.io(() => this.ports.open(path, flags).then(handle => { this.io.own(handle); return handle; }));
  }
  private async visit(handle: FileHandle, relative: string, named: string): Promise<void> {
    this.io.check();
    if (this.observed.length >= cleanupControl.maximumEntries) throw new OutputFailure('output_limit');
    const stat = await this.io.io(() => handle.stat({ bigint: true }));
    if (relative === '') requireInventory(sameNative(nativeFact(stat), this.root));
    requireInventory(await this.io.io(() => this.ports.mount(handle, this.io)) === this.mountId);
    const value = entry(relative, stat, this.root); const id = `${stat.dev}:${stat.ino}`;
    requireInventory(!this.identities.has(id)); this.identities.add(id); this.observed.push({ path: named, stat, entry: value });
    if (value.kind === 'directory') await this.children(handle, relative, named);
    const after = await this.io.io(() => handle.stat({ bigint: true })); requireInventory(signature(after) === signature(stat));
    const current = await this.io.io(() => this.ports.lstat(named, { bigint: true })); requireInventory(signature(current) === signature(stat));
  }
  private async children(handle: FileHandle, relative: string, named: string): Promise<void> {
    const stream = await this.io.io(() => this.ports.directory(this.ports.child(handle)).then(value => { this.io.own(value); return value; }));
    try {
      for (;;) {
        const row = await this.io.io(() => stream.read()); if (!row) return;
        const name = component(row.name, relative); const path = relative ? `${relative}/${name}` : name;
        if (this.observed.length >= cleanupControl.maximumEntries) throw new OutputFailure('output_limit');
        const childPath = this.ports.child(handle, name); const before = await this.io.io(() => this.ports.lstat(childPath, { bigint: true }));
        const value = entry(path, before, this.root); const child = await this.open(childPath, value.kind === 'directory');
        try {
          const actual = await this.io.io(() => child.stat({ bigint: true })); requireInventory(signature(actual) === signature(before));
          await this.visit(child, path, join(named, name));
        } finally { await this.io.closeHandles([child]); }
      }
    } finally { await this.io.closeHandles([stream]); }
  }
  async namedCheck(): Promise<void> {
    await this.installationRoot.namedCheck();
    requireInventory(await this.io.io(() => this.ports.realpath(this.directory)) === this.directory);
    for (const row of this.observed) {
      const current = await this.io.io(() => this.ports.lstat(row.path, { bigint: true }));
      requireInventory(signature(current) === signature(row.stat));
    }
  }
}
