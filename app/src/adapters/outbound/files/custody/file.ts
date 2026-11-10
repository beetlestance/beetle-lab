import type { BigIntStats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { createHash } from 'node:crypto';
export const FILE_CHUNK_BYTES = 65_536;
import type { Directories, Location } from './directories.js';
import { privateStat, same, sameFileOwner } from './identity.js';
import { errorCode, fail } from './errors.js';
import { createFlags, readFlags, writeFlags } from './native.js';

export class PhysicalFile {
  private constructor(readonly tree: Directories, public path: string,
    readonly handle: FileHandle, private identity: BigIntStats) {}
  static async open(tree: Directories, location: Location, writable: boolean): Promise<PhysicalFile | undefined> {
    await tree.check();
    if (!location.reachable) { await PhysicalFile.requireAbsent(tree, location.absentAncestor ?? location.path); return undefined; }
    let named: BigIntStats;
    try { named = await tree.owner.port.lstat(location.path, { bigint: true }); }
    catch (error) { if (errorCode(error) === 'ENOENT') return undefined; throw error; }
    privateStat(named, false);
    const handle = await tree.owner.open(location.path, writable ? writeFlags : readFlags);
    const stat = await handle.stat({ bigint: true });
    if (!same(named, stat)) fail('integrity');
    const file = new PhysicalFile(tree, location.path, handle, stat); await file.verify(); return file;
  }
  static async requireAbsent(tree: Directories, path: string): Promise<void> {
    await tree.check();
    try { await tree.owner.port.lstat(path, { bigint: true }); }
    catch (error) { if (errorCode(error) === 'ENOENT') { await tree.check(); return; } throw error; }
    fail('integrity');
  }
  static async create(tree: Directories, location: Location): Promise<PhysicalFile> {
    await tree.reserve(0);
    const handle = await tree.owner.open(location.path, createFlags, 0o600);
    const stat = await handle.stat({ bigint: true }); privateStat(stat, false);
    if (stat.nlink !== 1n || stat.size !== 0n) fail('integrity');
    const file = new PhysicalFile(tree, location.path, handle, stat);
    await file.verify(); await file.sync(); await tree.sync(location.parent); return file;
  }
  get size(): bigint { return this.identity.size; }
  get links(): bigint { return this.identity.nlink; }
  aliases(other: PhysicalFile): boolean { return same(this.identity, other.identity); }
  requireLinks(links: bigint): void { if (this.links !== links) fail('integrity'); }
  async verify(): Promise<void> {
    await this.tree.check();
    const named = await this.tree.owner.port.lstat(this.path, { bigint: true });
    const opened = await this.handle.stat({ bigint: true });
    if (!same(this.identity, named) || !same(this.identity, opened)) fail('integrity');
    await this.tree.check();
  }
  private async refresh(linkChange: boolean): Promise<void> {
    await this.tree.check();
    const stat = await this.handle.stat({ bigint: true }); privateStat(stat, false);
    const prior = this.identity;
    if (!sameFileOwner(prior, stat)) fail('integrity');
    if (linkChange && (prior.size !== stat.size || prior.mtimeNs !== stat.mtimeNs)) fail('integrity');
    if (!linkChange && prior.nlink !== stat.nlink) fail('integrity');
    this.identity = stat; await this.verify();
  }
  async refreshLink(path: string, links: bigint): Promise<void> {
    this.path = path; await this.refresh(true); this.requireLinks(links);
  }
  async sync(): Promise<void> {
    await this.verify(); await this.tree.owner.port.sync(this.handle); await this.verify();
  }
  async truncate(offset: number): Promise<void> {
    await this.verify(); await this.tree.owner.port.truncate(this.handle, offset);
    await this.refresh(false); await this.sync();
  }
  async read(position: number, length: number): Promise<Uint8Array> {
    if (length < 1 || length > FILE_CHUNK_BYTES) fail('invalid_input');
    await this.verify(); const bytes = new Uint8Array(length);
    const count = await this.tree.owner.port.read(this.handle, bytes, position);
    if (!Number.isInteger(count) || count < 1 || count > length) fail('integrity');
    await this.verify(); return bytes.subarray(0, count);
  }
  async write(bytes: Uint8Array, offset: number): Promise<void> {
    let written = 0;
    while (written < bytes.byteLength) {
      await this.verify();
      const count = await this.tree.owner.port.write(this.handle, bytes.subarray(written), offset + written);
      if (!Number.isInteger(count) || count < 1 || count > bytes.byteLength - written) fail('io');
      await this.refresh(false); written += count;
    }
    await this.sync();
  }
  async verifyContent(input: { readonly bytes: number; readonly sha256: string }): Promise<void> {
    if (this.size !== BigInt(input.bytes)) fail('integrity');
    const hash = createHash('sha256'); let offset = 0;
    while (offset < input.bytes) {
      const bytes = await this.read(offset, Math.min(FILE_CHUNK_BYTES, input.bytes - offset));
      hash.update(bytes); offset += bytes.byteLength;
    }
    await this.verify(); if (hash.digest('hex') !== input.sha256) fail('integrity');
  }
}
