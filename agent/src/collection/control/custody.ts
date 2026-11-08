import { constants } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { CONTROL_FILE, CONTROL_FILE_BYTES } from '../../control-protocol/index.js';
import { ControlReadError } from './types.js';
import type { ReaderPorts } from './ports.js';
import type { Operation } from './operation.js';

export function identity(a: BigIntStats, b: BigIntStats): boolean { return a.dev === b.dev && a.ino === b.ino; }
export function signature(s: BigIntStats): string {
  return `${s.dev}:${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`;
}
function assertMetadata(s: BigIntStats, uid: number, directory: boolean): void {
  const mode = directory ? 0o700n : 0o600n;
  const kind = directory ? s.isDirectory() : s.isFile();
  if (!kind || s.uid !== BigInt(uid) || (s.mode & 0o7777n) !== mode) throw new ControlReadError('custody');
  if (!directory && (s.nlink !== 1n || s.size > BigInt(CONTROL_FILE_BYTES))) throw new ControlReadError('custody');
}
function missing(error: unknown): boolean {
  return error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';
}
export class Custody {
  private parent: FileHandle | undefined;
  private file: FileHandle | undefined;
  private parentStat: BigIntStats | undefined;
  private fileStat: BigIntStats | undefined;
  private highSize = 0n;
  constructor(private readonly directory: string, private readonly uid: number, private readonly ports: ReaderPorts) {}
  private async openParent(op: Operation): Promise<void> {
    if (this.parent) return;
    const named = await op.io(() => this.ports.lstat(this.directory, { bigint: true }));
    assertMetadata(named, this.uid, true);
    await op.io(() => this.ports.open(this.directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
      .then(handle => { this.parent = handle; }));
    const actual = await op.io(() => this.parent!.stat({ bigint: true }));
    assertMetadata(actual, this.uid, true);
    if (!identity(named, actual)) throw new ControlReadError('custody');
    this.parentStat = actual;
  }
  async ensure(op: Operation): Promise<BigIntStats | null> {
    await this.openParent(op);
    if (this.file) return this.check(op);
    try { return await this.openFile(op); }
    catch (error) { if (missing(error) && !this.file) return null; throw error; }
  }
  private async openFile(op: Operation): Promise<BigIntStats> {
    await this.parentCheck(op);
    const path = join(this.directory, CONTROL_FILE);
    const named = await op.io(() => this.ports.lstat(path, { bigint: true }));
    assertMetadata(named, this.uid, false);
    await op.io(() => this.ports.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
      .then(handle => { this.file = handle; }));
    const actual = await op.io(() => this.file!.stat({ bigint: true }));
    if (!identity(named, actual)) throw new ControlReadError('custody');
    this.fileStat = actual;
    return this.check(op);
  }
  private async parentCheck(op: Operation): Promise<void> {
    const named = await op.io(() => this.ports.lstat(this.directory, { bigint: true }));
    const actual = await op.io(() => this.parent!.stat({ bigint: true }));
    assertMetadata(named, this.uid, true); assertMetadata(actual, this.uid, true);
    if (!this.parentStat || !identity(named, this.parentStat) || !identity(actual, this.parentStat)) {
      throw new ControlReadError('custody');
    }
  }
  async check(op: Operation): Promise<BigIntStats> {
    await this.parentCheck(op);
    const named = await op.io(() => this.ports.lstat(join(this.directory, CONTROL_FILE), { bigint: true }));
    const actual = await op.io(() => this.file!.stat({ bigint: true }));
    assertMetadata(named, this.uid, false); assertMetadata(actual, this.uid, false);
    if (!this.fileStat || !identity(named, this.fileStat) || !identity(actual, this.fileStat)) {
      throw new ControlReadError('custody');
    }
    if (named.size < this.highSize || actual.size < this.highSize) throw new ControlReadError('corruption');
    this.highSize = actual.size > named.size ? actual.size : named.size;
    return actual;
  }
  async read(op: Operation, position: number, length: number): Promise<Buffer> {
    const window = Buffer.allocUnsafe(length);
    op.calls++; // The counters include issued calls even if their original promise later fails.
    const { bytesRead } = await op.io(() => this.file!.read(window, 0, length, position));
    op.bytes += bytesRead;
    return window.subarray(0, bytesRead);
  }
  async close(): Promise<void> {
    const outcomes = await Promise.allSettled([
      Promise.resolve().then(() => this.file?.close()), Promise.resolve().then(() => this.parent?.close()),
    ]);
    if (outcomes.some(outcome => outcome.status === 'rejected')) throw new ControlReadError('io');
  }
}
