import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { namespaceCaps } from '../staging-namespace/index.js';
import type { NamespaceMarker } from '../staging-namespace/index.js';
import type { NativeDirectoryFact } from '../cleanup-control/index.js';
import type { OutputIO } from '../collection/output/index.js';
import type { InventoryPorts } from './ports.js';
import { nativeFact, requireInventory, sameNative, signature } from './checks.js';
export interface InventoryInstallation { readonly directory: string; readonly native: NativeDirectoryFact; readonly marker: NamespaceMarker }
export class InventoryRoot {
  private marker: BigIntStats | undefined;
  constructor(private readonly root: InventoryInstallation, private readonly io: OutputIO, private readonly ports: InventoryPorts) {}
  async open(): Promise<FileHandle> {
    requireInventory(await this.io.io(() => this.ports.realpath(this.root.directory)) === this.root.directory);
    const handle = await this.io.io(() => this.ports.open(this.root.directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
      .then(value => { this.io.own(value); return value; }));
    requireInventory(sameNative(nativeFact(await this.io.io(() => handle.stat({ bigint: true }))), this.root.native));
    await this.readMarker(handle); return handle;
  }
  private async readMarker(parent: FileHandle): Promise<void> {
    const handle = await this.io.io(() => this.ports.open(this.ports.child(parent, namespaceCaps.markerName), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
      .then(value => { this.io.own(value); return value; }));
    try {
      const stat = await this.io.io(() => handle.stat({ bigint: true })); const marker = this.root.marker;
      const native = { dev: String(stat.dev), ino: String(stat.ino), uid: String(stat.uid), gid: String(stat.gid), mode: String(stat.mode) };
      requireInventory(stat.isFile() && stat.nlink === 1n && sameNative(native, marker) && stat.size === BigInt(marker.bytes));
      requireInventory(stat.size <= BigInt(namespaceCaps.marker)); const buffer = Buffer.alloc(namespaceCaps.marker + 1);
      let position = 0;
      for (;;) {
        const read = await this.io.io(() => handle.read(buffer, position, buffer.length - position, position));
        if (!read.bytesRead) break; position += read.bytesRead; requireInventory(position <= namespaceCaps.marker);
      }
      requireInventory(position === Number(stat.size) && createHash('sha256').update(buffer.subarray(0, position)).digest('hex') === marker.sha256);
      requireInventory(signature(await this.io.io(() => handle.stat({ bigint: true }))) === signature(stat)); this.marker = stat;
    } finally { await this.io.closeHandles([handle]); }
  }
  async namedCheck(): Promise<void> {
    requireInventory(await this.io.io(() => this.ports.realpath(this.root.directory)) === this.root.directory);
    requireInventory(sameNative(nativeFact(await this.io.io(() => this.ports.lstat(this.root.directory, { bigint: true }))), this.root.native));
    const marker = await this.io.io(() => this.ports.lstat(`${this.root.directory}/${namespaceCaps.markerName}`, { bigint: true }));
    requireInventory(this.marker !== undefined && signature(marker) === signature(this.marker));
  }
}
