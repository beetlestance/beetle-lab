import { constants } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { encodeJson } from '@beetle/contracts';
import type { EngineResult } from '@beetle/contracts';
import type { SummaryEvidence } from '../collection/index.js';
import type { AttemptFence } from './fence.js';
import { AttemptError } from './types.js';

type Artifact = EngineResult['artifacts'][number];
interface ArtifactOptions { readonly directory: string; readonly uid: number; readonly fence: AttemptFence }
const cap = 1_048_576;
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
function same(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size
    && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}
function regular(stat: BigIntStats, uid: number, bytes: number): void {
  if (!stat.isFile() || stat.nlink !== 1n || stat.uid !== BigInt(uid) || (stat.mode & 0o777n) !== 0o600n
    || stat.size !== BigInt(bytes)) throw new AttemptError('artifact');
}
function namedArtifact(stat: BigIntStats | undefined, named: BigIntStats): void {
  if (!stat || !same(stat, named)) throw new AttemptError('artifact');
}
function directory(stat: BigIntStats, uid: number): void {
  if (!stat.isDirectory() || stat.uid !== BigInt(uid) || (stat.mode & 0o777n) !== 0o700n) throw new AttemptError('profile');
}
export async function outputRoot(options: ArtifactOptions): Promise<void> {
  options.fence.check();
  if (await realpath(options.directory) !== options.directory) throw new AttemptError('profile');
  directory(await lstat(options.directory, { bigint: true }), options.uid); options.fence.check();
  try { await lstat(join(options.directory, 'engine-result.json')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') { options.fence.check(); return; }
    throw error;
  }
  throw new AttemptError('journal');
}

/** Two fixed artifact names only. All descriptor outcomes retained, no speculative deletion. */
export class Artifacts {
  private failed = false;
  constructor(private readonly options: ArtifactOptions) {}
  get quiescence(): 'confirmed' | 'failed' { return this.failed ? 'failed' : 'confirmed'; }
  private async checked<T>(work: () => Promise<T>): Promise<T> {
    this.options.fence.check(); const value = await work(); this.options.fence.check(); return value;
  }
  private async read(file: FileHandle, bytes: number): Promise<Uint8Array> {
    const content = new Uint8Array(bytes);
    for (let offset = 0, calls = 0; offset < bytes;) {
      if (++calls > 32) throw new AttemptError('artifact');
      const read = await this.checked(() => file.read(content, offset, Math.min(65_536, bytes - offset), offset));
      if (!Number.isSafeInteger(read.bytesRead) || read.bytesRead < 1 || read.bytesRead > Math.min(65_536, bytes - offset)) {
        throw new AttemptError('artifact');
      }
      offset += read.bytesRead;
    }
    const tail = await this.checked(() => file.read(new Uint8Array(1), 0, 1, bytes));
    if (tail.bytesRead !== 0) throw new AttemptError('artifact');
    return content;
  }
  private async write(file: FileHandle, bytes: Uint8Array): Promise<void> {
    for (let offset = 0, calls = 0; offset < bytes.length;) {
      if (++calls > 32) throw new AttemptError('artifact');
      const length = Math.min(65_536, bytes.length - offset);
      const written = await this.checked(() => file.write(bytes, offset, length, offset));
      if (!Number.isSafeInteger(written.bytesWritten) || written.bytesWritten < 1 || written.bytesWritten > length) {
        throw new AttemptError('artifact');
      }
      offset += written.bytesWritten;
    }
  }
  private async parent(): Promise<{ handle: FileHandle; stat: BigIntStats }> {
    const path = this.options.directory;
    if (await this.checked(() => realpath(path)) !== path) throw new AttemptError('artifact');
    const named = await this.checked(() => lstat(path, { bigint: true })); directory(named, this.options.uid);
    const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    // Retain the handle before any subsequent check can fail.
    try {
      const stat = await this.checked(() => handle.stat({ bigint: true })); directory(stat, this.options.uid);
      if (named.dev !== stat.dev || named.ino !== stat.ino) throw new AttemptError('artifact');
      return { handle, stat };
    } catch (error) {
      try { await handle.close(); } catch { this.failed = true; }
      throw error;
    }
  }
  private async custody(name: string, bytes: number, expected: string, content?: Uint8Array): Promise<Artifact> {
    const parent = await this.parent(); let file: FileHandle | undefined; let stat: BigIntStats | undefined;
    let error: unknown;
    const path = join(this.options.directory, name);
    try {
      const flags = constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK
        | (content ? constants.O_CREAT | constants.O_EXCL : 0);
      file = await open(path, flags, 0o600); this.options.fence.check();
      if (content) await this.write(file, content);
      stat = await this.verify(file, bytes, expected);
    } catch (failure) { error = failure;
    } finally {
      const outcomes = await Promise.allSettled([Promise.resolve().then(() => file?.close()),
        Promise.resolve().then(() => this.checked(() => parent.handle.sync())), Promise.resolve().then(async () => {
          const named = await lstat(this.options.directory, { bigint: true }); directory(named, this.options.uid);
          if (named.dev !== parent.stat.dev || named.ino !== parent.stat.ino) throw new AttemptError('artifact');
        })]);
      try { await parent.handle.close(); } catch { this.failed = true; }
      if (outcomes.some(value => value.status === 'rejected')) this.failed = true;
    }
    if (this.failed) throw new AttemptError('cleanup');
    if (error !== undefined) throw error;
    this.options.fence.check();
    const named = await this.checked(() => lstat(path, { bigint: true })); regular(named, this.options.uid, bytes);
    namedArtifact(stat, named);
    return Object.freeze({ artifactId: randomUUID(), kind: content ? 'numeric-final' : 'native-summary',
      relativePath: name, bytes, sha256: expected, sealedAt: this.options.fence.timestamp() });
  }
  private async verify(file: FileHandle, bytes: number, expected: string): Promise<BigIntStats> {
    const stat = await this.checked(() => file.stat({ bigint: true })); regular(stat, this.options.uid, bytes);
    for (let pass = 0; pass < 2; pass++) {
      if (hash(await this.read(file, bytes)) !== expected) throw new AttemptError('artifact');
    }
    await this.checked(() => file.sync());
    const after = await this.checked(() => file.stat({ bigint: true })); regular(after, this.options.uid, bytes);
    if (!same(stat, after)) throw new AttemptError('artifact');
    return stat;
  }
  async summary(evidence: SummaryEvidence): Promise<Artifact> {
    if (!Number.isSafeInteger(evidence.rawBytes) || evidence.rawBytes < 1 || evidence.rawBytes > cap) throw new AttemptError('artifact');
    return this.custody('beetle-evidence.json', evidence.rawBytes, evidence.sha256);
  }
  async numeric(value: unknown, allowance = cap): Promise<Artifact> {
    if (!Number.isSafeInteger(allowance) || allowance < 1 || allowance > cap) throw new AttemptError('output_limit');
    let bytes: Buffer;
    try { bytes = Buffer.from(encodeJson(value, allowance - 1) + '\n'); }
    catch { throw new AttemptError('output_limit'); }
    return this.custody('numeric-final.json', bytes.length, hash(bytes), bytes);
  }
}
