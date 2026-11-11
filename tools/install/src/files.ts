import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import type { BigIntStats, Dir } from 'node:fs';
import { dirname, join } from 'node:path';
import { ProvisionError } from '../types.js';
import type { Captured } from './capture.js';
import { check } from './capture.js';

/** Private fault seam: production always uses native original promises. */
export const native = { open: fs.open, lstat: fs.lstat, realpath: fs.realpath, mkdir: fs.mkdir,
  opendir: fs.opendir, rename: fs.rename };
const retained = new Set<object>();
let requestCleanupFailed = false;
let requestActive = false;
function unsafe(condition: unknown): asserts condition { if (!condition) throw new ProvisionError('unsafe_root'); }
function absent(error: unknown): boolean { return error instanceof Error && 'code' in error && error.code === 'ENOENT'; }
interface Pin { handle: FileHandle; info: BigIntStats }

/** Holds all issued IO until settlement. Failed close retains the owner permanently. */
export class PrivateFiles {
  private readonly pins = new Map<string, Pin>();
  private failedClose = false;
  private receiptPin: BigIntStats | undefined;
  constructor(readonly captured: Captured) {}
  get clean(): boolean { return !this.failedClose; }
  private owned(info: BigIntStats, directory: boolean): void {
    const { uid, gid } = this.captured.request;
    unsafe(info.uid === BigInt(uid) && info.gid === BigInt(gid));
    unsafe((info.mode & 0o777n) === (directory ? 0o700n : 0o600n));
    unsafe(directory ? info.isDirectory() : info.isFile() && info.nlink === 1n);
  }
  async closeHandle(handle: FileHandle): Promise<void> {
    try { await handle.close(); }
    catch (cause) { this.failedClose = true; retained.add(this); retained.add(handle); throw new ProvisionError('cleanup', { cause }); }
  }
  async assertPins(): Promise<void> {
    check(this.captured.context);
    for (const [path, pin] of this.pins) {
      const info = await native.lstat(path, { bigint: true }); this.owned(info, true);
      unsafe(info.dev === pin.info.dev && info.ino === pin.info.ino && await native.realpath(path) === path);
    }
    check(this.captured.context);
  }
  async pin(path: string): Promise<void> {
    await this.assertPins();
    const handle = await native.open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      const info = await handle.stat({ bigint: true }); this.owned(info, true);
      const actual = await native.lstat(path, { bigint: true });
      unsafe(actual.dev === info.dev && actual.ino === info.ino && await native.realpath(path) === path);
      this.pins.set(path, { handle, info });
    } catch (cause) { await this.closeHandle(handle); throw cause; }
    await this.assertPins();
  }
  async root(): Promise<void> {
    const root = this.captured.request.root;
    try { await native.lstat(root); }
    catch (cause) {
      if (!absent(cause)) throw cause;
      await this.pin(dirname(root));
      await native.mkdir(root, { mode: 0o700 });
      await this.sync(dirname(root));
    }
    await this.pin(root);
  }
  async directory(path: string, create: boolean): Promise<void> {
    await this.assertPins();
    if (create) { await native.mkdir(path, { mode: 0o700 }); await this.sync(dirname(path)); }
    await this.pin(path);
  }
  private async closeDirectory(directory: Dir): Promise<void> {
    try { await directory.close(); }
    catch (cause) { this.failedClose = true; retained.add(directory); retained.add(this); throw new ProvisionError('cleanup', { cause }); }
  }
  async names(path: string, allowed: readonly string[]): Promise<string[]> {
    await this.assertPins(); const directory = await native.opendir(path); const names: string[] = [];
    try {
      for (let count = 0; count <= allowed.length; count++) {
        const entry = await directory.read();
        if (entry === null) { await this.assertPins(); return names; }
        if (!allowed.includes(entry.name)) throw new ProvisionError('recovery_required');
        names.push(entry.name);
      }
      throw new ProvisionError('recovery_required');
    } finally { await this.closeDirectory(directory); }
  }
  async read(path: string, maximum = 262_144): Promise<Uint8Array> {
    await this.assertPins();
    const handle = await native.open(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
    try {
      const info = await handle.stat({ bigint: true }); this.owned(info, false);
      if (path === join(this.captured.request.root, 'installation.json')) this.receiptPin = info;
      unsafe(info.size > 0n && info.size <= BigInt(maximum));
      const bytes = new Uint8Array(maximum + 1); let offset = 0;
      for (let count = 0; count < 64; count++) {
        check(this.captured.context);
        const result = await handle.read(bytes, offset, bytes.length - offset, offset); offset += result.bytesRead;
        unsafe(offset <= maximum);
        if (result.bytesRead === 0) {
          const after = await handle.stat({ bigint: true }); this.owned(after, false);
          unsafe(after.size === BigInt(offset) && after.mtimeNs === info.mtimeNs && after.ctimeNs === info.ctimeNs);
          const current = await native.lstat(path, { bigint: true });
          unsafe(current.ino === info.ino && current.dev === info.dev); await this.assertPins(); return bytes.slice(0, offset);
        }
      }
      throw new ProvisionError('io');
    } finally { await this.closeHandle(handle); }
  }
  async write(path: string, bytes: Uint8Array): Promise<void> {
    unsafe(bytes.length <= 262_144); await this.assertPins();
    const handle = await native.open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      const original = await handle.stat({ bigint: true }); this.owned(original, false);
      if (path === join(this.captured.request.root, 'installation.json')) this.receiptPin = original;
      let offset = 0;
      for (let count = 0; count < 64 && offset < bytes.length; count++) {
        check(this.captured.context);
        const result = await handle.write(bytes, offset, bytes.length - offset, offset);
        if (result.bytesWritten < 1) throw new ProvisionError('io'); offset += result.bytesWritten;
      }
      if (offset !== bytes.length) throw new ProvisionError('io');
      await handle.sync(); await this.assertPins();
      const current = await native.lstat(path, { bigint: true }); this.owned(current, false);
      unsafe(current.ino === original.ino && current.dev === original.dev);
    } finally { await this.closeHandle(handle); }
    await this.sync(dirname(path));
  }
  async sync(path: string): Promise<void> {
    const pin = this.pins.get(path);
    if (!pin) throw new ProvisionError('unsafe_root');
    await pin.handle.sync();
  }
  async metadata(path: string, optional = false): Promise<void> {
    await this.assertPins();
    try { this.owned(await native.lstat(path, { bigint: true }), false); }
    catch (cause) { if (!optional || !absent(cause)) throw cause; }
  }
  async ready(receipt: unknown, operationId: string): Promise<void> {
    const root = this.captured.request.root; const target = join(root, 'installation.json');
    const temporary = join(root, `.installation-${operationId}`);
    await this.write(temporary, Buffer.from(JSON.stringify(receipt))); await this.assertPins();
    const original = this.pins.get(root)!.info;
    const current = await native.lstat(target, { bigint: true }); this.owned(current, false);
    unsafe(current.ino === this.receiptPin?.ino && current.dev === this.receiptPin?.dev);
    // Ordinary originals drain before commit. Only receipt commit IO follows.
    await this.close(); check(this.captured.context);
    const commit = await native.open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      const info = await commit.stat({ bigint: true }); this.owned(info, true);
      unsafe(info.dev === original.dev && info.ino === original.ino && await native.realpath(root) === root);
      check(this.captured.context); await native.rename(temporary, target); await commit.sync();
    } finally { await this.closeHandle(commit); }
    check(this.captured.context);
  }
  async close(): Promise<void> {
    const originals = [...this.pins.values()]; this.pins.clear();
    const results = await Promise.allSettled(originals.map(pin => this.closeHandle(pin.handle)));
    const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
    if (failures.length) throw new ProvisionError('cleanup', { cause: new AggregateError(failures, 'Private files cleanup failed') });
  }
}
export async function readRequest(path: string, operation: Pick<Captured['context'], 'signal' | 'deadline'>): Promise<unknown> {
  if (requestCleanupFailed) throw new ProvisionError('cleanup');
  if (requestActive) throw new ProvisionError('conflict');
  requestActive = true;
  try { return await capturedRequest(path, operation); } finally { requestActive = false; }
}
async function capturedRequest(path: string, operation: Pick<Captured['context'], 'signal' | 'deadline'>): Promise<unknown> {
  check(operation);
  const info = await native.lstat(dirname(path), { bigint: true });
  // CLI parent may be shared; the request itself must remain private and canonical.
  unsafe(info.isDirectory() && await native.realpath(path) === path);
  const handle = await native.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const metadata = await requestMetadata(handle); check(operation);
    const bytes = new Uint8Array(262_145); let offset = 0;
    for (let count = 0; count < 64; count++) {
      const result = await handle.read(bytes, offset, bytes.length - offset, offset); offset += result.bytesRead;
      unsafe(offset <= 262_144);
      check(operation);
      if (result.bytesRead === 0) {
        await unchangedRequest(handle, path, metadata, offset);
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, offset))) as unknown;
      }
    }
    throw new ProvisionError('invalid_input');
  } finally { await closeRequest(handle); }
}
async function requestMetadata(handle: FileHandle): Promise<BigIntStats> {
  const metadata = await handle.stat({ bigint: true });
  unsafe(metadata.isFile() && metadata.nlink === 1n && metadata.uid === BigInt(process.getuid!())
    && (metadata.mode & 0o777n) === 0o600n && metadata.size > 0n && metadata.size <= 262_144n);
  return metadata;
}
async function unchangedRequest(handle: FileHandle, path: string, before: BigIntStats, size: number): Promise<void> {
  const after = await requestMetadata(handle); const current = await native.lstat(path, { bigint: true });
  unsafe(after.size === BigInt(size) && after.mtimeNs === before.mtimeNs && after.ctimeNs === before.ctimeNs);
  unsafe(current.ino === before.ino && current.dev === before.dev);
}
async function closeRequest(handle: FileHandle): Promise<void> {
  try { await handle.close(); }
  catch (cause) { requestCleanupFailed = true; retained.add(handle); throw new ProvisionError('cleanup', { cause }); }
}

