import { constants } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { AgentConfigurationError } from './error.js';
import { absolutePath } from './validation.js';

/** Feature-local fault seam. Production uses the native operations below. */
export interface FileOperations {
  open(path: string, flags: number): Promise<FileHandle>;
  read(handle: FileHandle, buffer: Uint8Array, position: number): Promise<number>;
  close(handle: FileHandle): Promise<void>;
}
export const nativeFiles: FileOperations = {
  open: (path, flags) => open(path, flags),
  read: async (handle, buffer, position) => (await handle.read(buffer, 0, buffer.byteLength, position)).bytesRead,
  close: handle => handle.close(),
};
function same(a: BigIntStats, b: BigIntStats): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mode === b.mode
    && a.uid === b.uid && a.gid === b.gid && a.nlink === b.nlink
    && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}
function privateFile(info: BigIntStats, maximum: number): void {
  if (!info.isFile() || info.nlink !== 1n || info.size < 1n || info.size > BigInt(maximum)
    || process.getuid === undefined || info.uid !== BigInt(process.getuid()) || (info.mode & 0o077n) !== 0n) {
    throw new AgentConfigurationError();
  }
}
async function named(path: string): Promise<BigIntStats> {
  if (await realpath(path) !== path) throw new AgentConfigurationError();
  return lstat(path, { bigint: true });
}
async function verify(path: string, handle: FileHandle, identity: BigIntStats): Promise<void> {
  if (!same(identity, await handle.stat({ bigint: true })) || !same(identity, await named(path))) {
    throw new AgentConfigurationError();
  }
}
async function boundedRead(handle: FileHandle, maximum: number, files: FileOperations): Promise<Uint8Array> {
  const bytes = new Uint8Array(maximum + 1);
  let size = 0;
  try {
    for (let calls = 0; calls < 64; calls++) {
      const count = await files.read(handle, bytes.subarray(size), size);
      if (!Number.isInteger(count) || count < 0 || count > bytes.byteLength - size) throw new AgentConfigurationError();
      size += count;
      if (size > maximum) throw new AgentConfigurationError();
      if (count === 0) return bytes.slice(0, size);
    }
    throw new AgentConfigurationError();
  } finally { bytes.fill(0); }
}

/** One original at a time; a failed close permanently retains its descriptor and promise. */
export class PrivateFileReader {
  private stranded: { readonly handle: FileHandle; readonly original: Promise<void> } | undefined;
  constructor(private readonly files: FileOperations) {}
  get failed(): boolean { return this.stranded !== undefined; }
  async read(path: string, maximum: number): Promise<Uint8Array> {
    absolutePath(path);
    const before = await named(path); privateFile(before, maximum);
    const handle = await this.files.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let bytes: Uint8Array | undefined;
    let failed = false;
    try {
      await verify(path, handle, before);
      bytes = await boundedRead(handle, maximum, this.files);
      await verify(path, handle, before);
      if (bytes.byteLength !== Number(before.size)) throw new AgentConfigurationError();
    } catch { bytes?.fill(0); failed = true; }
    const original = Promise.resolve().then(() => this.files.close(handle));
    try { await original; }
    catch { this.stranded = { handle, original }; bytes?.fill(0); throw new AgentConfigurationError(); }
    if (failed || !bytes) throw new AgentConfigurationError();
    try {
      if (!same(before, await named(path))) throw new AgentConfigurationError();
      return bytes;
    } catch (error) { bytes.fill(0); throw error; }
  }
}
