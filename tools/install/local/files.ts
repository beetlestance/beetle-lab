import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import type { BigIntStats, Dir } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { dirname } from 'node:path';
import { ProvisionError } from '../types.js';
import type { LocalOptions } from './config.js';
import { check } from '../src/capture.js';

export interface Operation { signal: AbortSignal; deadline: number }
export const native = { open: fs.open, lstat: fs.lstat, realpath: fs.realpath, mkdir: fs.mkdir, opendir: fs.opendir };
export function absent(error: unknown): boolean { return error instanceof Error && 'code' in error && error.code === 'ENOENT'; }
function safe(condition: unknown): asserts condition { if (!condition) throw new ProvisionError('unsafe_root'); }
const retained = new Set<object>();
/** Configuration custody only. Never opens Journal or acquires installation authority. */
export class LocalFiles {
  private readonly pins = new Map<string, { handle: FileHandle; info: BigIntStats }>();
  constructor(private readonly options: LocalOptions, private readonly operation: Operation) {}
  private owned(info: BigIntStats, directory: boolean): void {
    safe(info.uid === BigInt(this.options.uid) && info.gid === BigInt(this.options.gid));
    safe((info.mode & 0o777n) === (directory ? 0o700n : 0o600n));
    safe(directory ? info.isDirectory() : info.isFile() && info.nlink === 1n);
  }
  private async closeOne(handle: FileHandle): Promise<void> {
    try { await handle.close(); } catch (cause) { retained.add(handle); throw new ProvisionError('cleanup', { cause }); }
  }
  private async closeDirectory(directory: Dir): Promise<void> {
    try { await directory.close(); } catch (cause) { retained.add(directory); throw new ProvisionError('cleanup', { cause }); }
  }
  async assertPins(): Promise<void> {
    check(this.operation);
    for (const [name, pin] of this.pins) {
      const current = await native.lstat(name, { bigint: true }); this.owned(current, true);
      safe(current.ino === pin.info.ino && current.dev === pin.info.dev && await native.realpath(name) === name);
    }
  }
  async directory(name: string, create: boolean): Promise<void> {
    await this.assertPins();
    if (create) { await native.mkdir(name, { mode: 0o700 }); await this.sync(dirname(name)); }
    safe(await native.realpath(name) === name);
    const handle = await native.open(name, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      const info = await handle.stat({ bigint: true }); this.owned(info, true); this.pins.set(name, { handle, info });
    } catch (cause) { await this.closeOne(handle); throw cause; }
    await this.assertPins();
  }
  async sync(name: string): Promise<void> {
    const pin = this.pins.get(name); if (pin) { await pin.handle.sync(); return; }
    const handle = await native.open(name, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { await handle.sync(); } finally { await this.closeOne(handle); }
  }
  async names(name: string, maximum: number): Promise<string[]> {
    await this.assertPins(); const directory = await native.opendir(name); const names: string[] = [];
    try {
      for (let count = 0; count <= maximum; count++) {
        check(this.operation); const entry = await directory.read(); if (!entry) return names; names.push(entry.name);
      }
      throw new ProvisionError('recovery_required');
    } finally { await this.closeDirectory(directory); }
  }
  async read(name: string): Promise<string> {
    await this.assertPins();
    const handle = await native.open(name, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = await handle.stat({ bigint: true }); this.owned(before, false); safe(before.size > 0n && before.size <= 262144n);
      const bytes = new Uint8Array(Number(before.size) + 1); let offset = 0;
      for (let count = 0; count < 64; count++) {
        check(this.operation); const result = await handle.read(bytes, offset, bytes.length - offset, offset); offset += result.bytesRead;
        safe(offset <= Number(before.size));
        if (result.bytesRead === 0) {
          const after = await handle.stat({ bigint: true }); const current = await native.lstat(name, { bigint: true });
          this.owned(after, false); this.owned(current, false);
          safe(after.size === BigInt(offset) && after.mtimeNs === before.mtimeNs && after.ctimeNs === before.ctimeNs);
          safe(current.ino === before.ino && current.dev === before.dev); await this.assertPins();
          return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, offset));
        }
      }
      throw new ProvisionError('io');
    } finally { await this.closeOne(handle); }
  }
  async write(name: string, value: string): Promise<void> {
    await this.assertPins(); const bytes = Buffer.from(value); safe(bytes.length <= 262144);
    const handle = await native.open(name, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      const original = await handle.stat({ bigint: true }); this.owned(original, false); let offset = 0;
      for (let count = 0; count < 64 && offset < bytes.length; count++) {
        check(this.operation); const result = await handle.write(bytes, offset, bytes.length - offset, offset);
        safe(result.bytesWritten > 0); offset += result.bytesWritten;
      }
      safe(offset === bytes.length); await handle.sync(); await this.assertPins();
      const current = await native.lstat(name, { bigint: true }); this.owned(current, false);
      safe(current.ino === original.ino && current.dev === original.dev);
    } finally { await this.closeOne(handle); }
    await this.sync(dirname(name));
  }
  async close(): Promise<void> {
    const results = await Promise.allSettled([...this.pins.values()].map(pin => this.closeOne(pin.handle))); this.pins.clear();
    if (results.some(result => result.status === 'rejected')) throw new ProvisionError('cleanup');
  }
}
