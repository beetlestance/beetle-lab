import { constants } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import type { OutputFileContext, OutputFileJob } from '../../../../ports/output-bytes.js';
import { Custody, Directories, checkRoots, same, sameDirectory } from '../custody/index.js';
import type { NativePort, PhysicalFile, Roots } from '../custody/index.js';
import type { OutputLease } from './lease.js';
import { JobPolicy } from './policy.js';
import { guardedPort } from './native.js';
import { fail, safeError } from './errors.js';

class JobCustody extends Custody {
  readonly directories = new Map<string, BigIntStats>();
  constructor(port: NativePort, private readonly policy: JobPolicy) { super(port, { freeSpaceReserveBytes: policy.reserve }); }
  override check(): void { this.policy.check(); super.check(); }
  override async open(path: string, flags: number, mode?: number): Promise<FileHandle> {
    const handle = await super.open(path, flags, mode);
    if (flags & constants.O_DIRECTORY) this.directories.set(path, await handle.stat({ bigint: true }));
    this.check(); return handle;
  }
}
export class FileJob<T> implements OutputFileJob<T> {
  readonly policy: JobPolicy;
  readonly result: Promise<T>;
  readonly settled: Promise<void>;
  private resolve!: (value: T) => void;
  private reject!: (error: unknown) => void;
  private release!: () => void;
  private owner?: JobCustody;
  private confirmation?: { path: string; stat: BigIntStats };
  tree!: Directories;
  token?: string;
  constructor(private readonly options: { port: NativePort; roots: Roots; lease: OutputLease; clock: () => number;
    done(job: FileJob<unknown>): void; broken(): void }) {
    this.policy = new JobPolicy(options.clock);
    this.result = new Promise<T>((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
    this.settled = new Promise<void>(resolve => { this.release = resolve; });
  }
  capture(context: OutputFileContext): void { this.policy.capture(context); }
  start(work: () => Promise<T>): void { void this.execute(work).then(this.resolve, this.reject); }
  refuse(error: unknown): void { this.complete(); this.reject(safeError(error)); }
  private complete(): void { this.options.done(this as FileJob<unknown>); this.release(); }
  async confirm(file: PhysicalFile): Promise<BigIntStats> {
    await file.verify(); const stat = await file.handle.stat({ bigint: true }); await file.verify();
    this.confirmation = { path: file.path, stat }; return stat;
  }
  private async postClose(): Promise<void> {
    await this.options.lease.check(); await checkRoots(this.options.port, this.options.roots);
    for (const [path, stat] of this.owner!.directories) {
      if (!sameDirectory(stat, await this.options.port.lstat(path, { bigint: true }))) fail('integrity');
    }
    if (this.confirmation) {
      const current = await this.options.port.lstat(this.confirmation.path, { bigint: true });
      if (!same(this.confirmation.stat, current)) fail('integrity');
    }
    this.policy.check();
  }
  private async execute(work: () => Promise<T>): Promise<T> {
    let value: T | undefined; let failure: unknown;
    this.owner = new JobCustody(guardedPort(this.options.port, () => this.policy.check()), this.policy);
    this.tree = new Directories(this.owner, this.options.roots);
    try { this.policy.check(); await this.options.lease.check(); await this.tree.check(); value = await work(); }
    catch (error) { failure = safeError(error); }
    if (!await this.owner.close()) { this.options.broken(); fail('cleanup'); }
    if (!failure) {
      try { await this.postClose(); } catch (error) { failure = safeError(error); }
    }
    this.complete();
    if (failure) throw failure;
    return value as T;
  }
}
