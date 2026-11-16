import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import type { BigIntStats } from 'node:fs';
import { ancestry, privateStat, recheckParents, same } from './root.js';
import type { NamedIdentity } from './root.js';
import { check } from './capture.js';
import { ProviderError } from './types.js';

/** Private fault seam; production callers always use native operations. */
export interface FilePort {
  open(path: string, flags: number): Promise<FileHandle>;
  close(handle: FileHandle): Promise<void>;
  read(handle: FileHandle, buffer: Uint8Array, position: number): Promise<number>;
}
export const nativePort: FilePort = {
  open: (path, flags) => open(path, flags),
  close: handle => handle.close(),
  read: async (handle, buffer, position) => (await handle.read(buffer, 0, buffer.byteLength, position)).bytesRead,
};
const owners = new Set<FileLease>();
export class FileLease {
  private handle: FileHandle | undefined;
  private opening: Promise<void> | undefined;
  private closing: Promise<void> | undefined;
  private parents: readonly NamedIdentity[] = [];
  private identity: BigIntStats | undefined;
  private retained: Promise<never> | undefined;
  failed = false;
  private constructor(readonly path: string, private readonly port: FilePort) {}
  static acquire(path: string, port = nativePort): FileLease {
    if (owners.size >= 2) throw new ProviderError('busy');
    const lease = new FileLease(path, port); owners.add(lease); return lease;
  }
  open(maximum: number, signal?: AbortSignal): Promise<void> {
    this.opening ??= this.openOriginal(maximum, signal);
    return this.opening;
  }
  private async openOriginal(maximum: number, signal?: AbortSignal): Promise<void> {
    check(signal);
    this.parents = await ancestry(this.path); check(signal);
    const named = await lstat(this.path, { bigint: true }); this.validate(named, maximum); check(signal);
    this.handle = await this.port.open(this.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    check(signal);
    const opened = await this.handle.stat({ bigint: true });
    if (!same(named, opened)) throw new ProviderError('io');
    this.identity = opened;
    await this.verify(); check(signal);
  }
  private validate(stat: BigIntStats, maximum: number): void {
    privateStat(stat);
    if (!stat.isFile() || stat.nlink !== 1n || stat.size > BigInt(maximum)) throw new ProviderError('io');
  }
  async verify(): Promise<void> {
    await recheckParents(this.parents);
    const named = await lstat(this.path, { bigint: true });
    if (!this.identity || !same(this.identity, named)) throw new ProviderError('io');
    if (this.handle && !same(this.identity, await this.handle.stat({ bigint: true }))) throw new ProviderError('io');
  }
  get size(): number {
    if (!this.identity) throw new ProviderError('io');
    return Number(this.identity.size);
  }
  async read(position: number, length: number, signal?: AbortSignal): Promise<Uint8Array> {
    check(signal); await this.verify(); check(signal);
    if (!this.handle) throw new ProviderError('io');
    const buffer = new Uint8Array(length);
    const count = await this.port.read(this.handle, buffer, position);
    check(signal); await this.verify(); check(signal);
    if (!Number.isInteger(count) || count < 0 || count > length) throw new ProviderError('io');
    return buffer.slice(0, count);
  }
  close(): Promise<void> {
    this.closing ??= Promise.resolve().then(() => this.closeOriginal()).catch(error => {
      throw error instanceof ProviderError ? error : new ProviderError('io');
    });
    return this.closing;
  }
  private async closeOriginal(): Promise<void> {
    try { await this.opening; } catch { /* Opening failure still owns a late descriptor. */ }
    let verification: unknown;
    if (this.identity) { try { await this.verify(); } catch (error) { verification = error; } }
    if (this.handle) {
      try { await this.port.close(this.handle); }
      catch { this.failed = true; throw new ProviderError('cleanup'); }
      this.handle = undefined;
    }
    try { if (this.identity) await this.verify(); }
    finally { owners.delete(this); }
    if (verification) throw new ProviderError('io');
  }
  /** Failed close deliberately never proves materialized read quiescence. */
  retainFailure(): Promise<never> { this.retained ??= new Promise(() => undefined); return this.retained; }
}
