import { constants } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { hashArtifactFile } from '../../artifact-custody/index.js';
import { join } from 'node:path';
import { same, regular, directory } from '../../artifact-custody/index.js';
import { AttemptError } from '../types.js';

export const names = { data: 'metric-windows.ndjson', index: 'metric-index.ndjson' } as const;
export type Lane = keyof typeof names;
interface Options { root: string; uid: number; check(): void }
interface OwnedFile { handle: FileHandle; bytes: number }

/** Two fixed files and one retained root. Caller serializes writes, verification and cleanup. */
export class MetricFiles {
  private parent: FileHandle | undefined;
  private identity: BigIntStats | undefined;
  private readonly files = new Map<Lane, OwnedFile>();
  private closing: Promise<void> | undefined;
  private cleanupFailed = false;
  private constructor(private readonly options: Options) {}
  static async create(options: Options): Promise<MetricFiles> {
    const owner = new MetricFiles(options);
    try { await owner.initialize(); return owner; }
    catch (error) { await owner.close(); throw error; }
  }
  get quiescence(): 'confirmed' | 'failed' { return this.cleanupFailed ? 'failed' : 'confirmed'; }
  private async checked<T>(work: () => Promise<T>): Promise<T> {
    this.options.check(); const value = await work(); this.options.check(); return value;
  }
  private async initialize(): Promise<void> {
    const root = this.options.root;
    if (await this.checked(() => realpath(root)) !== root) throw new AttemptError('profile');
    const named = await this.checked(() => lstat(root, { bigint: true })); directory(named, this.options.uid);
    this.parent = await open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    this.options.check();
    this.identity = await this.checked(() => this.parent!.stat({ bigint: true }));
    directory(this.identity, this.options.uid);
    if (named.dev !== this.identity.dev || named.ino !== this.identity.ino) throw new AttemptError('artifact');
    for (const lane of ['data', 'index'] as const) {
      const handle = await open(join(root, names[lane]), constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      this.files.set(lane, { handle, bytes: 0 }); this.options.check();
      regular(await this.checked(() => handle.stat({ bigint: true })), this.options.uid, 0);
    }
  }
  async append(lane: Lane, bytes: Uint8Array): Promise<void> {
    const file = this.files.get(lane); if (!file) throw new AttemptError('artifact');
    const limit = Math.ceil(bytes.length / 65_536) + 32;
    for (let offset = 0, calls = 0; offset < bytes.length;) {
      if (++calls > limit) throw new AttemptError('artifact');
      const length = Math.min(65_536, bytes.length - offset);
      const value = await this.checked(() => file.handle.write(bytes, offset, length, file.bytes));
      if (!Number.isSafeInteger(value.bytesWritten) || value.bytesWritten < 1 || value.bytesWritten > length) throw new AttemptError('artifact');
      offset += value.bytesWritten; file.bytes += value.bytesWritten;
    }
  }
  private async verifyRoot(): Promise<void> {
    const root = this.options.root;
    if (await this.checked(() => realpath(root)) !== root) throw new AttemptError('artifact');
    const named = await this.checked(() => lstat(root, { bigint: true })); directory(named, this.options.uid);
    if (!this.identity || named.dev !== this.identity.dev || named.ino !== this.identity.ino) throw new AttemptError('artifact');
  }
  async verify(lane: Lane, expected: { bytes: number; sha256: string }): Promise<BigIntStats> {
    const file = this.files.get(lane); if (!file || file.bytes !== expected.bytes) throw new AttemptError('artifact');
    await this.verifyRoot();
    await this.checked(() => file.handle.sync());
    const before = await this.checked(() => file.handle.stat({ bigint: true })); regular(before, this.options.uid, expected.bytes);
    const digest = await this.hash(file);
    if (digest !== expected.sha256) throw new AttemptError('artifact');
    const after = await this.checked(() => file.handle.stat({ bigint: true })); regular(after, this.options.uid, expected.bytes);
    if (!same(before, after)) throw new AttemptError('artifact');
    await this.verifyRoot(); return after;
  }
  private hash(file: OwnedFile): Promise<string> {
    return hashArtifactFile({file: file.handle, bytes: file.bytes, maximumBytes: 256 * 1048576, check: () => this.options.check()});
  }
  async verifyNames(stats: ReadonlyMap<Lane, BigIntStats>): Promise<void> {
    await this.verifyRoot();
    for (const [lane, stat] of stats) {
      const named = await this.checked(() => lstat(join(this.options.root, names[lane]), { bigint: true }));
      regular(named, this.options.uid, Number(stat.size));
      if (!same(stat, named)) throw new AttemptError('artifact');
    }
  }
  async syncParent(): Promise<void> { await this.checked(() => this.parent!.sync()); }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closing = Promise.resolve().then(async () => {
      const handles = [...this.files.values()].map(file => file.handle);
      if (this.parent) handles.push(this.parent);
      const outcomes = await Promise.allSettled(handles.map(handle => Promise.resolve().then(() => handle.close())));
      if (outcomes.some(value => value.status === 'rejected')) { this.cleanupFailed = true; throw new AttemptError('cleanup'); }
    });
    return this.closing;
  }
}
