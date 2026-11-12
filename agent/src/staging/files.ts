import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, opendir } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import type { BigIntStats, Dir } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Boundary } from './bounds.js';
import { checkRoot } from './root.js';
import type { RootIdentity } from './root.js';
import { StagingError } from './types.js';
import { namespaceCaps, captureTaskDirectories } from '../staging-namespace/index.js';
import type { TaskDirectoryFacts } from '../staging-namespace/index.js';
import type { NativeDirectoryFact, NativeFileFact } from '../cleanup-control/index.js';
export interface StagingFilesPort {
  stat(path: string): Promise<BigIntStats>;
  canonical(path: string): Promise<string>;
  open(path: string, flags: number, mode: number): Promise<FileHandle>;
  mkdir(path: string, mode: number): Promise<void>;
  directory(path: string): Promise<Dir>;
}
const nativeFiles: StagingFilesPort = { stat: path => lstat(path, { bigint: true }), canonical: realpath,
  open, mkdir: async (path, mode) => { await mkdir(path, { mode }); }, directory: path => opendir(path, { bufferSize: 1 }) };
export interface MarkerObservation {
  readonly native: NativeFileFact; readonly modifiedNs: bigint; readonly changedNs: bigint;
}
type Closable = FileHandle | Dir;
function nativeDirectory(stat: BigIntStats): NativeDirectoryFact {
  return { dev: stat.dev.toString(), ino: stat.ino.toString(), uid: stat.uid.toString(), gid: stat.gid.toString(), mode: stat.mode.toString() };
}
function sameDirectory(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.uid === right.uid && left.gid === right.gid && left.mode === right.mode;
}
function sameMarkerRead(left: BigIntStats, right: BigIntStats): boolean {
  return sameDirectory(left, right) && left.size === right.size && left.nlink === right.nlink
    && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}
/** One operation at a time; at most two owned originals, including rejected closes. */
export class Files {
  private readonly handles = new Map<Closable, { closing?: Promise<void> }>();
  private iterator: AsyncIterator<Uint8Array> | undefined;
  private readonly directories = new Map<string, NativeDirectoryFact>();
  private closing: Promise<void> | undefined;
  constructor(readonly root: RootIdentity, readonly boundary: Boundary, readonly check: () => Promise<void>,
    private readonly native: StagingFilesPort = nativeFiles) {}
  async directory(path: string): Promise<void> {
    if (this.directories.size >= 4) throw new StagingError('io');
    await this.check(); await checkRoot(this.root, this.boundary);
    await this.createDirectory(path);
    const stat = await this.boundary.wait(() => this.native.stat(path));
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.dev !== this.root.dev || stat.uid !== BigInt(this.root.uid)
      || stat.gid !== BigInt(this.root.gid) || (stat.mode & 0o7777n) !== 0o700n) throw new StagingError('io');
    this.directories.set(path, nativeDirectory(stat));
    if (await this.boundary.wait(() => this.native.canonical(path)) !== path) throw new StagingError('io');
  }
  private async createDirectory(path: string): Promise<void> {
    try { await this.boundary.wait(() => this.native.mkdir(path, 0o700)); }
    catch (error) {
      if (error && typeof error === 'object' && Object.getOwnPropertyDescriptor(error, 'code')?.value === 'EEXIST') {
        throw new StagingError('recovery_required', { cause: error });
      }
      throw error;
    }
  }
  private async parents(): Promise<void> {
    await this.check(); await checkRoot(this.root, this.boundary);
    for (const [path, identity] of this.directories) {
      const stat = await this.boundary.wait(() => this.native.stat(path));
      if (!stat.isDirectory() || stat.ino.toString() !== identity.ino || stat.dev.toString() !== identity.dev
        || stat.uid !== BigInt(this.root.uid) || stat.gid !== BigInt(this.root.gid) || (stat.mode & 0o7777n) !== 0o700n) throw new StagingError('io');
    }
  }
  private own<T extends Closable>(handle: T): T { this.handles.set(handle, {}); return handle; }
  private capacity(): void { if (this.closing || this.handles.size >= 2) throw new StagingError('busy'); }
  private descriptor(path: string, flags: number, mode = 0o400): Promise<FileHandle> {
    this.capacity(); return this.boundary.wait(() => this.native.open(path, flags, mode).then(handle => this.own(handle)));
  }
  private async regular(handle: FileHandle, size: number, mode = 0o600): Promise<BigIntStats> {
    const stat = await this.boundary.wait(() => handle.stat({ bigint: true }));
    if (!stat.isFile() || stat.nlink !== 1n || stat.uid !== BigInt(this.root.uid) || stat.gid !== BigInt(this.root.gid)
      || stat.dev !== this.root.dev || stat.size !== BigInt(size) || (stat.mode & 0o7777n) !== BigInt(mode)) throw new StagingError('io');
    return stat;
  }
  async file(directory: string, name: string, chunks: AsyncIterable<Uint8Array>, limit: number,
    consume?: (chunk: Uint8Array) => void): Promise<number> {
    await this.parents();
    const handle = await this.descriptor(join(directory, name), constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_WRONLY, 0o600);
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
    await this.boundary.wait(() => handle.chmod(0o400));
    await this.regular(handle, size, 0o400); await this.boundary.wait(() => handle.sync());
    await this.regular(handle, size, 0o400); await this.boundary.wait(() => this.closeDescriptor(handle)); return size;
  }
  async syncDirectories(): Promise<void> {
    await this.parents();
    for (const path of [...this.directories.keys()].reverse().concat(this.root.configuration.stagingRoot)) {
      const handle = await this.descriptor(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY);
      await this.boundary.wait(() => handle.sync()); await this.boundary.wait(() => this.closeDescriptor(handle));
    }
  }
  async directoryFacts(paths: Record<keyof TaskDirectoryFacts, string>): Promise<TaskDirectoryFacts> {
    await this.parents(); const facts: Record<string, NativeDirectoryFact> = {};
    for (const role of ['task', 'input', 'output', 'secrets'] as const) {
      const native = this.directories.get(paths[role]); if (!native) throw new StagingError('io'); facts[role] = native;
    }
    return captureTaskDirectories(facts);
  }
  /** At most two entries are observed; an overflow is explicit to the namespace owner. */
  async namespaceEntries(): Promise<string[]> {
    await this.parents(); this.capacity();
    const directory = await this.boundary.wait(() => this.native.directory(this.root.configuration.stagingRoot).then(handle => this.own(handle)));
    const names: string[] = [];
    for (let count = 0; count < 2; count++) {
      const entry = await this.boundary.wait(() => directory.read()); if (!entry) break; names.push(entry.name);
    }
    await this.boundary.wait(() => this.closeDescriptor(directory)); await this.parents(); return names;
  }
  /** Validates per-start ancestry without pinning ephemeral container ancestor inodes durably. */
  async namespaceAncestors(): Promise<void> {
    await this.parents(); const root = this.root.configuration.stagingRoot;
    const handle = await this.descriptor(root, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY);
    await this.directoryDescriptor(handle, root);
    let path = dirname(root);
    for (let depth = 0; ; depth++) {
      if (depth >= 256) throw new StagingError('installation');
      const parent = await this.descriptor(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY);
      await this.directoryDescriptor(parent, path); await this.boundary.wait(() => this.closeDescriptor(parent));
      if (path === '/') break; path = dirname(path);
    }
    await this.directoryDescriptor(handle, root); await this.parents();
    await this.boundary.wait(() => this.closeDescriptor(handle));
  }
  private async directoryDescriptor(handle: FileHandle, path: string): Promise<void> {
    const descriptor = await this.boundary.wait(() => handle.stat({ bigint: true }));
    const named = await this.boundary.wait(() => this.native.stat(path));
    if (!descriptor.isDirectory() || !named.isDirectory() || named.isSymbolicLink()
      || !sameDirectory(descriptor, named)
      || await this.boundary.wait(() => this.native.canonical(path)) !== path) throw new StagingError('installation');
  }
  async readNamespaceMarker(size: number): Promise<{ observation: MarkerObservation; bytes: Uint8Array }> {
    if (!Number.isSafeInteger(size) || size < 1 || size > namespaceCaps.marker) throw new StagingError('invalid_input');
    await this.parents();
    const handle = await this.descriptor(join(this.root.configuration.stagingRoot, namespaceCaps.markerName), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await this.regular(handle, size, 0o400); const buffer = new Uint8Array(size + 1);
    const offset = await this.readMarkerBuffer(handle, buffer);
    const after = await this.regular(handle, size, 0o400);
    if (offset !== size || !sameMarkerRead(before, after)) throw new StagingError('io');
    const observation: MarkerObservation = { native: { ...nativeDirectory(after), bytes: after.size.toString(), links: '1' },
      modifiedNs: after.mtimeNs, changedNs: after.ctimeNs };
    await this.verifyNamespaceMarker(observation);
    await this.boundary.wait(() => this.closeDescriptor(handle)); await this.verifyNamespaceMarker(observation);
    return { observation, bytes: buffer.slice(0, size) };
  }
  /** Named identity and transient mutation guards: no new descriptor or durable timestamp authority. */
  async verifyNamespaceMarker(observation: MarkerObservation): Promise<void> {
    await this.parents(); const path = join(this.root.configuration.stagingRoot, namespaceCaps.markerName);
    this.markerMatches(await this.boundary.wait(() => this.native.stat(path)), observation);
    if (await this.boundary.wait(() => this.native.canonical(path)) !== path) throw new StagingError('installation');
    await this.parents();
    this.markerMatches(await this.boundary.wait(() => this.native.stat(path)), observation);
  }
  private markerMatches(stat: BigIntStats, observation: MarkerObservation): void {
    const expected = observation.native; const named = nativeDirectory(stat);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n || stat.size.toString() !== expected.bytes) throw new StagingError('installation');
    if (!Object.entries(named).every(([field, value]) => value === expected[field as keyof NativeDirectoryFact])) throw new StagingError('installation');
    if (stat.mtimeNs !== observation.modifiedNs || stat.ctimeNs !== observation.changedNs) throw new StagingError('installation');
  }
  private async readMarkerBuffer(handle: FileHandle, buffer: Uint8Array): Promise<number> {
    let offset = 0;
    while (offset < buffer.byteLength) {
      const read = await this.boundary.wait(() => handle.read(buffer, offset, buffer.byteLength - offset, offset));
      if (!Number.isSafeInteger(read.bytesRead) || read.bytesRead < 0 || read.bytesRead > buffer.byteLength - offset) throw new StagingError('io');
      if (read.bytesRead === 0) break; offset += read.bytesRead;
    }
    return offset;
  }
  private closeDescriptor(handle: Closable): Promise<void> {
    const owned = this.handles.get(handle); if (!owned) throw new StagingError('io');
    owned.closing ??= Promise.resolve().then(() => handle.close()).then(() => { this.handles.delete(handle); }); return owned.closing;
  }
  private async returnIterator(): Promise<void> {
    if (this.iterator?.return) await this.iterator.return(); this.iterator = undefined;
  }
  close(): Promise<void> {
    this.closing ??= this.closeOriginals(); return this.closing;
  }
  private async closeOriginals(): Promise<void> {
    const outcomes = await Promise.allSettled([this.returnIterator(), ...Array.from(this.handles.keys(), handle => this.closeDescriptor(handle))]);
    const failures = outcomes.flatMap(outcome => outcome.status === 'rejected' ? [outcome.reason as unknown] : []);
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, 'Staging close failed', { cause: failures[0] });
  }
}
/** A <=4MiB source chunk plus its private copy bounds the retained window to8MiB. */
export function boundedChunk(raw: unknown, remaining: number): Uint8Array {
  if (!(raw instanceof Uint8Array) || raw.byteLength > 4_194_304 || raw.byteLength > remaining) throw new StagingError('input_integrity'); return new Uint8Array(raw);
}
export async function* bytes(value: Uint8Array): AsyncIterable<Uint8Array> { yield value; }
