import { constants } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { join } from 'node:path';
import { PublicationError } from './types.js';
import type { Profile } from './profile.js';
import type { Budget } from './budget.js';
import type { PublicationFile, PublicationIo } from './ports.js';

function identity(stat: BigIntStats): boolean { return typeof stat.dev === 'bigint' && stat.dev >= 0n && typeof stat.ino === 'bigint' && stat.ino > 0n; }
function same(left: BigIntStats, right: BigIntStats): boolean { return identity(left) && identity(right) && left.dev === right.dev && left.ino === right.ino; }
function file(stat: BigIntStats, uid: number, bytes: number): void {
  if (!identity(stat) || !stat.isFile() || stat.uid !== BigInt(uid) || stat.nlink !== 1n || (stat.mode & 0o777n) !== 0o600n || stat.size !== BigInt(bytes)) {
    throw new PublicationError('integrity');
  }
}
function directory(stat: BigIntStats, uid: number): void {
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== BigInt(uid) || (stat.mode & 0o777n) !== 0o700n) {
    throw new PublicationError('profile');
  }
}
export class Files {
  private parent: PublicationFile | undefined;
  private output: PublicationFile | undefined;
  private parentIdentity: BigIntStats | undefined;
  private fileIdentity: BigIntStats | undefined;
  private readonly target: string;
  private fileClose: Promise<void> | undefined;
  private closing: Promise<void> | undefined;
  constructor(private readonly profile: Profile, private readonly budget: Budget, private readonly io: PublicationIo) {
    this.target = join(profile.directory, profile.relativePath);
  }
  async open(): Promise<void> {
    this.budget.check();
    if (await this.io.realpath(this.profile.directory) !== this.profile.directory) throw new PublicationError('profile');
    this.budget.check();
    this.parent = await this.io.open(this.profile.directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    this.budget.check(); this.parentIdentity = await this.parent.stat(); this.budget.check();
    await this.checkDirectory();
    this.budget.check();
    try {
      this.output = await this.io.open(this.target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
        | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new PublicationError('exists');
      throw error;
    }
    this.budget.check(); this.fileIdentity = await this.output.stat(); this.budget.check();
    file(this.fileIdentity, this.profile.uid, 0);
  }
  async write(): Promise<void> {
    let offset = 0; let calls = 0;
    while (offset < this.profile.bytes.byteLength) {
      this.budget.check();
      if (++calls > 128) throw new PublicationError('limit');
      const length = Math.min(65_536, this.profile.bytes.byteLength - offset);
      const result = await this.output!.write(this.profile.bytes, offset, length, offset);
      this.budget.check();
      if (!Number.isInteger(result.bytesWritten) || result.bytesWritten < 1 || result.bytesWritten > length) throw new PublicationError('filesystem');
      offset += result.bytesWritten;
    }
    const stat = await this.output!.stat(); this.budget.check();
    file(stat, this.profile.uid, this.profile.bytes.byteLength);
    if (!same(stat, this.fileIdentity!)) throw new PublicationError('integrity');
    await this.output!.sync(); this.budget.check();
    await this.closeFile(); this.budget.check();
  }
  async publish(): Promise<void> {
    await this.checkDirectory(); await this.checkFile();
    await this.checkDirectory(); await this.parent!.sync(); this.budget.check();
    await this.checkFile(); await this.checkDirectory();
  }
  private async checkFile(): Promise<void> {
    const final = await this.io.lstat(this.target); this.budget.check();
    file(final, this.profile.uid, this.profile.bytes.byteLength);
    if (!same(final, this.fileIdentity!)) throw new PublicationError('integrity');
  }
  private async checkDirectory(): Promise<void> {
    const named = await this.io.lstat(this.profile.directory); this.budget.check();
    const opened = await this.parent!.stat(); this.budget.check();
    directory(named, this.profile.uid); directory(opened, this.profile.uid);
    if (!same(named, opened) || !same(opened, this.parentIdentity!)) throw new PublicationError('integrity');
  }
  private closeFile(): Promise<void> {
    if (this.fileClose) return this.fileClose;
    const handle = this.output;
    this.fileClose = Promise.resolve().then(() => handle?.close());
    return this.fileClose;
  }
  close(): Promise<void> {
    this.closing ??= this.finishClose(); return this.closing;
  }
  private async finishClose(): Promise<void> {
    // Each original close is attempted once, independently of the other's result.
    const outcomes = await Promise.allSettled([this.closeFile(), Promise.resolve().then(() => this.parent?.close())]);
    if (outcomes.some(outcome => outcome.status === 'rejected')) throw new PublicationError('filesystem');
  }
}
