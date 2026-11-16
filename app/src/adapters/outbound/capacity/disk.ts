import { constants } from 'node:fs';
import type { BigIntStats, BigIntStatsFs } from 'node:fs';
import { lstat, open, realpath, statfs } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { isAbsolute, normalize } from 'node:path';

/** Internal native seam; each issued promise remains owned until settlement. */
export interface DiskPort {
  lstat(path: string, options: { bigint: true }): Promise<BigIntStats>;
  realpath(path: string): Promise<string>;
  open(path: string, flags: number): Promise<FileHandle>;
  statfs(path: string, options: { bigint: true }): Promise<BigIntStatsFs>;
  close(handle: FileHandle): Promise<void>;
}
export const nativeDisk: DiskPort = { lstat, open, realpath, statfs, close: handle => handle.close() };
export class CapacityError extends Error {
  constructor() { super('Capacity source unavailable'); this.name = 'CapacityError'; }
}
let stranded: FileHandle | undefined;
function privateRoot(info: BigIntStats): void {
  if (!info.isDirectory() || process.getuid === undefined || info.uid !== BigInt(process.getuid())
    || (info.mode & 0o7777n) !== 0o700n) throw new CapacityError();
}
function sameRoot(expected: BigIntStats, actual: BigIntStats): void {
  privateRoot(actual);
  const keys = ['dev', 'ino', 'uid', 'gid', 'mode'] as const;
  if (!keys.every(key => expected[key] === actual[key])) throw new CapacityError();
}
async function retainedClose(port: DiskPort, handle: FileHandle): Promise<void> {
  try { await port.close(handle); }
  catch {
    stranded = handle;
    await new Promise<never>(() => { /* Failed close cannot establish native drainage. */ });
  }
}
export class BackendDisk {
  private closing: Promise<void> | undefined;
  constructor(private readonly path: string, private readonly port: DiskPort,
    private readonly handle: FileHandle, private readonly identity: BigIntStats) {}
  async check(check: () => void): Promise<void> {
    check(); sameRoot(this.identity, await this.port.lstat(this.path, { bigint: true }));
    check();
    if (await this.port.realpath(this.path) !== this.path) throw new CapacityError();
    check(); sameRoot(this.identity, await this.handle.stat({ bigint: true })); check();
  }
  async sample(check: () => void): Promise<{ total: number; available: number }> {
    await this.check(check);
    const space = await this.port.statfs(this.path, { bigint: true }); check();
    const total = bytes(space.blocks, space.bsize); const available = bytes(space.bavail, space.bsize);
    if (available > total || total === 0) throw new CapacityError();
    await this.check(check);
    return { total, available };
  }
  close(): Promise<void> { return this.closing ??= retainedClose(this.port, this.handle); }
}
function bytes(blocks: bigint, size: bigint): number {
  if (blocks < 0n || size <= 0n) throw new CapacityError();
  const product = blocks * size;
  if (product > BigInt(Number.MAX_SAFE_INTEGER)) throw new CapacityError();
  return Number(product);
}
export async function pinDisk(path: string, port: DiskPort): Promise<BackendDisk> {
  if (stranded || !isAbsolute(path) || normalize(path) !== path || Buffer.byteLength(path) > 1024
    || path.split('/').length > 32) throw new CapacityError();
  const identity = await port.lstat(path, { bigint: true }); privateRoot(identity);
  if (await port.realpath(path) !== path) throw new CapacityError();
  const flags = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY | constants.O_NONBLOCK;
  const handle = await port.open(path, flags);
  try {
    const disk = new BackendDisk(path, port, handle, identity);
    await disk.check(() => undefined); return disk;
  } catch {
    await retainedClose(port, handle); throw new CapacityError();
  }
}
