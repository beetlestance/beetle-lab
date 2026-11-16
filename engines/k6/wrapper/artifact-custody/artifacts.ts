import { captureK6Diagnostics } from '@beetle/contracts/k6-diagnostics';
import { captureK6Warnings } from '@beetle/contracts/k6-warnings';
import { captureTargetRuntimeReport } from '@beetle/contracts/target-runtime';
import { constants } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { encodeJson } from '@beetle/contracts';
import type { EngineResult } from '@beetle/contracts';
import type { SummaryEvidence } from '../collection/index.js';
import { AttemptError } from '../failure/index.js';
import { hashArtifactFile } from './hash.js';
import { same, regular, directory } from './identity.js';

type Artifact = EngineResult['artifacts'][number];
export interface ArtifactFence {check(): void; timestamp(): string}
interface ArtifactOptions { readonly resultFile?: 'engine-result.json' | 'export-result.json'; readonly directory: string; readonly uid: number; readonly fence: ArtifactFence }
const cap = 1_048_576;
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
function namedArtifact(stat: BigIntStats | undefined, named: BigIntStats): void {
  if (!stat || !same(stat, named)) throw new AttemptError('artifact');
}
export async function outputRoot(options: ArtifactOptions): Promise<void> {
  const resultFile=options.resultFile ?? 'engine-result.json';
  if (!['engine-result.json','export-result.json'].includes(resultFile)) throw new AttemptError('profile');
  options.fence.check();
  if (await realpath(options.directory) !== options.directory) throw new AttemptError('profile');
  directory(await lstat(options.directory, { bigint: true }), options.uid); options.fence.check();
  try { await lstat(join(options.directory, resultFile)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') { options.fence.check(); return; }
    throw error;
  }
  throw new AttemptError('journal');
}

/** Fixed artifact names only. All descriptor outcomes retained, no speculative deletion. */
export class Artifacts {
  private failed = false;
  private readonly options: ArtifactOptions;
  constructor(options: ArtifactOptions) {
    this.options = Object.freeze({directory: options.directory, uid: options.uid, fence: Object.freeze({
      check: options.fence.check.bind(options.fence), timestamp: options.fence.timestamp.bind(options.fence)})});
  }
  get quiescence(): 'confirmed' | 'failed' { return this.failed ? 'failed' : 'confirmed'; }
  private async checked<T>(work: () => Promise<T>): Promise<T> {
    this.options.fence.check(); const value = await work(); this.options.fence.check(); return value;
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
  private async custody(name: string, bytes: number, expected: string | undefined, content?: Uint8Array, kind = 'native-summary'): Promise<Artifact> {
    const parent = await this.parent(); let file: FileHandle | undefined; let stat: BigIntStats | undefined;
    let error: unknown; let checksum = expected;
    const path = join(this.options.directory, name);
    try {
      const flags = constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK
        | (content ? constants.O_CREAT | constants.O_EXCL : 0);
      file = await open(path, flags, 0o600); this.options.fence.check();
      if (content) await this.write(file, content);
      const verified = await this.verify(file, bytes, expected); stat = verified.stat; checksum = verified.sha256;
    } catch (failure) { error = failure;
    } finally {
      const outcomes = await Promise.allSettled([Promise.resolve().then(() => file?.close()),
        Promise.resolve().then(() => parent.handle.sync()), Promise.resolve().then(() => this.verifyParent(parent.stat, 'cleanup'))]);
      try { await parent.handle.close(); } catch { this.failed = true; }
      if (outcomes.some(value => value.status === 'rejected')) this.failed = true;
    }
    if (this.failed) throw new AttemptError('cleanup');
    if (error !== undefined) throw error;
    this.options.fence.check();
    const named = await this.checked(() => lstat(path, { bigint: true })); regular(named, this.options.uid, bytes);
    namedArtifact(stat, named); await this.verifyParent(parent.stat, 'publication');
    return Object.freeze({ artifactId: randomUUID(), kind,
      relativePath: name, bytes, sha256: checksum!, sealedAt: this.options.fence.timestamp() });
  }
  private async verifyParent(expected: BigIntStats, phase: 'publication' | 'cleanup'): Promise<void> {
    const issue = <T>(work: () => Promise<T>): Promise<T> => phase === 'cleanup' ? work() : this.checked(work);
    if (await issue(() => realpath(this.options.directory)) !== this.options.directory) throw new AttemptError('artifact');
    const named = await issue(() => lstat(this.options.directory,{bigint:true})); directory(named,this.options.uid);
    if (named.dev !== expected.dev || named.ino !== expected.ino) throw new AttemptError('artifact');
  }
  private async verify(file: FileHandle, bytes: number, expected: string | undefined): Promise<{stat: BigIntStats; sha256: string}> {
    const stat = await this.checked(() => file.stat({ bigint: true })); regular(stat, this.options.uid, bytes);
    let checksum = expected;
    for (let pass = 0; pass < 2; pass++) {
      const actual = await hashArtifactFile({file, bytes, maximumBytes: 64 * 1048576, check: () => this.options.fence.check()});
      if (checksum !== undefined && actual !== checksum) throw new AttemptError('artifact'); checksum = actual;
    }
    await this.checked(() => file.sync());
    const after = await this.checked(() => file.stat({ bigint: true })); regular(after, this.options.uid, bytes);
    if (!same(stat, after)) throw new AttemptError('artifact');
    return {stat, sha256: checksum!};
  }
  async existingScript(bytes: number, allowance: number): Promise<Artifact> {
    this.options.fence.check();
    if (!Number.isSafeInteger(allowance) || allowance < 1 || allowance > 64 * 1048576
      || !Number.isSafeInteger(bytes) || bytes < 1 || bytes > allowance) throw new AttemptError('output_limit');
    return this.custody('suite.js', bytes, undefined, undefined, 'standalone-k6-script');
  }
  async summary(evidence: SummaryEvidence): Promise<Artifact> {
    if (!Number.isSafeInteger(evidence.rawBytes) || evidence.rawBytes < 1 || evidence.rawBytes > cap) throw new AttemptError('artifact');
    return this.custody('beetle-evidence.json', evidence.rawBytes, evidence.sha256);
  }
  async numeric(value: unknown, allowance = cap): Promise<Artifact> {
    return this.encoded(value, allowance, 'numeric-final.json', 'numeric-final');
  }
  async warnings(value: unknown, allowance: number): Promise<Artifact> {
    return this.encoded(captureK6Warnings(value), allowance, 'k6-warnings.json', 'k6-warnings');
  }
  async diagnostics(value: unknown, allowance: number): Promise<Artifact> {
    return this.encoded(captureK6Diagnostics(value), allowance, 'k6-diagnostics.json', 'k6-diagnostics');
  }
  async target(value: unknown, allowance: number): Promise<Artifact> {
    return this.encoded(captureTargetRuntimeReport(value), allowance, 'target-runtime.json', 'target-runtime');
  }
  async report(kind: 'performance-report' | 'metrics-csv', content: Uint8Array, allowance: number): Promise<Artifact> {
    this.options.fence.check();
    if (!(content instanceof Uint8Array) || !Number.isSafeInteger(allowance) || allowance < 1
      || allowance > 262144 || content.length < 1 || content.length > allowance) throw new AttemptError('output_limit');
    if (kind !== 'performance-report' && kind !== 'metrics-csv') throw new AttemptError('artifact');
    const bytes = Buffer.from(content);
    return this.custody(kind === 'performance-report' ? 'performance-report.txt' : 'metrics.csv', bytes.length, hash(bytes), bytes, kind);
  }
  private async encoded(value: unknown, allowance: number, name: string, kind: string): Promise<Artifact> {
    if (!Number.isSafeInteger(allowance) || allowance < 1 || allowance > cap) throw new AttemptError('output_limit');
    let bytes: Buffer;
    try { bytes = Buffer.from(encodeJson(value, allowance - 1) + '\n'); }
    catch { throw new AttemptError('output_limit'); }
    return this.custody(name, bytes.length, hash(bytes), bytes, kind);
  }
}
