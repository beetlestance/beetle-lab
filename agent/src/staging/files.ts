import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import type { Boundary } from './bounds.js';
import { checkRoot } from './root.js';
import type { RootIdentity } from './root.js';
import { StagingError } from './types.js';

/** Owns at most one descriptor, with late opens retained for quiescent close. */
export class Files {
  private readonly handles = new Map<FileHandle, { closing?: Promise<void> }>();
  private iterator: AsyncIterator<Uint8Array> | undefined;
  private readonly directories = new Map<string, { ino: number; dev: number }>();
  constructor(readonly root: RootIdentity, readonly boundary: Boundary, readonly check: () => Promise<void>) {}
  async directory(path: string): Promise<void> {
    await this.check(); await checkRoot(this.root, this.boundary);
    await this.boundary.wait(() => mkdir(path, { mode: 0o700 }));
    const stat = await this.boundary.wait(() => lstat(path));
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.dev !== this.root.dev || stat.uid !== this.root.uid
      || stat.gid !== this.root.gid || (stat.mode & 0o777) !== 0o700) throw new StagingError('io');
    this.directories.set(path, { ino: stat.ino, dev: stat.dev });
    if (await this.boundary.wait(() => realpath(path)) !== path) throw new StagingError('io');
  }
  private async parents(): Promise<void> {
    await this.check(); await checkRoot(this.root, this.boundary);
    for (const [path, identity] of this.directories) {
      const stat = await this.boundary.wait(() => lstat(path));
      if (!stat.isDirectory() || stat.ino !== identity.ino || stat.dev !== identity.dev
        || stat.uid !== this.root.uid || stat.gid !== this.root.gid || (stat.mode & 0o777) !== 0o700) throw new StagingError('io');
    }
  }
  private async descriptor(path: string, flags: number): Promise<FileHandle> {
    return this.boundary.wait(() => open(path, flags, 0o400).then(handle => { this.handles.set(handle, {}); return handle; }));
  }
  private async regular(handle: FileHandle, size: number): Promise<void> {
    const stat = await this.boundary.wait(() => handle.stat());
    if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== this.root.uid || stat.gid !== this.root.gid
      || stat.size !== size || (stat.mode & 0o777) !== 0o400) throw new StagingError('io');
  }
  async file(directory: string, name: string, chunks: AsyncIterable<Uint8Array>, limit: number,
    consume?: (chunk: Uint8Array) => void): Promise<number> {
    await this.parents();
    const handle = await this.descriptor(join(directory, name), constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_WRONLY);
    let size = 0;
    const iterator = chunks[Symbol.asyncIterator](); this.iterator = iterator;
    while (true) {
      const next = await this.boundary.wait(() => iterator.next());
      if (next.done) { this.iterator = undefined; break; }
      const chunk = boundedChunk(next.value, limit - size);
      await this.parents(); await this.regular(handle, size);
      const result = await this.boundary.wait(() => handle.write(chunk, 0, chunk.byteLength, size));
      if (result.bytesWritten !== chunk.byteLength) throw new StagingError('io');
      size += chunk.byteLength; consume?.(chunk);
    }
    await this.parents(); await this.regular(handle, size);
    await this.boundary.wait(() => handle.sync());
    await this.regular(handle, size);
    await this.boundary.wait(() => this.closeDescriptor(handle));
    return size;
  }
  async syncDirectories(): Promise<void> {
    await this.parents();
    for (const path of [...this.directories.keys()].reverse().concat(this.root.configuration.stagingRoot)) {
      const handle = await this.descriptor(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY);
      await this.boundary.wait(() => handle.sync());
      await this.boundary.wait(() => this.closeDescriptor(handle));
    }
  }
  private closeDescriptor(handle: FileHandle): Promise<void> {
    const owned = this.handles.get(handle);
    if (!owned) throw new StagingError('io');
    // Node retires the fd before native close settles; a second close can resolve falsely.
    owned.closing ??= Promise.resolve().then(() => handle.close()).then(() => { this.handles.delete(handle); });
    return owned.closing;
  }
  private async returnIterator(): Promise<void> {
    if (this.iterator?.return) await this.iterator.return();
    this.iterator = undefined;
  }
  async close(): Promise<void> {
    const outcomes = await Promise.allSettled([
      this.returnIterator(), ...Array.from(this.handles.keys(), handle => this.closeDescriptor(handle)),
    ]);
    for (const outcome of outcomes) if (outcome.status === 'rejected') throw outcome.reason;
  }

}
/** A <=4 MiB source chunk plus its private copy bounds the retained write window to 8 MiB. */
export function boundedChunk(raw: unknown, remaining: number): Uint8Array {
  if (!(raw instanceof Uint8Array) || raw.byteLength > 4_194_304 || raw.byteLength > remaining) throw new StagingError('input_integrity');
  return new Uint8Array(raw);
}
export async function* bytes(value: Uint8Array): AsyncIterable<Uint8Array> { yield value; }
