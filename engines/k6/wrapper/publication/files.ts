import { constants } from 'node:fs';
import type { Stats } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { PublicationError } from './types.js';
import type { Profile } from './profile.js';
import type { Budget } from './budget.js';
import type { PublicationFile, PublicationIo } from './ports.js';

function identity(stat: Stats): boolean { return Number.isSafeInteger(stat.dev) && stat.dev >= 0 && Number.isSafeInteger(stat.ino) && stat.ino > 0; }
function same(left: Stats, right: Stats): boolean { return identity(left) && identity(right) && left.dev === right.dev && left.ino === right.ino; }
function file(stat: Stats, uid: number, bytes: number): void {
  if (!identity(stat) || !stat.isFile() || stat.uid !== uid || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600 || stat.size !== bytes) {
    throw new PublicationError('integrity');
  }
}
function directory(stat: Stats, uid: number): void {
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== uid || (stat.mode & 0o777) !== 0o700) {
    throw new PublicationError('profile');
  }
}
export class Files {
  private parent: PublicationFile | undefined;
  private pending: PublicationFile | undefined;
  private parentIdentity: Stats | undefined;
  private fileIdentity: Stats | undefined;
  private path: string | undefined;
  private readonly target: string;
  private fileClose: Promise<void> | undefined;
  private closing: Promise<void> | undefined;
  constructor(private readonly profile: Profile, private readonly budget: Budget, private readonly io: PublicationIo) {
    this.target = join(profile.directory, 'engine-result.json');
  }
  async open(): Promise<void> {
    this.budget.check();
    if (await this.io.realpath(this.profile.directory) !== this.profile.directory) throw new PublicationError('profile');
    this.budget.check();
    this.parent = await this.io.open(this.profile.directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    this.budget.check(); this.parentIdentity = await this.parent.stat(); this.budget.check();
    await this.checkDirectory();
    this.budget.check();
    this.path = join(this.profile.directory, '.engine-result.pending-' + randomUUID());
    this.pending = await this.io.open(this.path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
      | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
    this.budget.check(); this.fileIdentity = await this.pending.stat(); this.budget.check();
    file(this.fileIdentity, this.profile.uid, 0);
  }
  async write(): Promise<void> {
    let offset = 0; let calls = 0;
    while (offset < this.profile.bytes.byteLength) {
      this.budget.check();
      if (++calls > 128) throw new PublicationError('limit');
      const length = Math.min(65_536, this.profile.bytes.byteLength - offset);
      const result = await this.pending!.write(this.profile.bytes, offset, length, offset);
      this.budget.check();
      if (!Number.isInteger(result.bytesWritten) || result.bytesWritten < 1 || result.bytesWritten > length) throw new PublicationError('filesystem');
      offset += result.bytesWritten;
    }
    const stat = await this.pending!.stat(); this.budget.check();
    file(stat, this.profile.uid, this.profile.bytes.byteLength);
    if (!same(stat, this.fileIdentity!)) throw new PublicationError('integrity');
    await this.pending!.sync(); this.budget.check();
    await this.closeFile(); this.budget.check();
  }
  async publish(): Promise<void> {
    const path = this.path;
    if (!path) throw new PublicationError('integrity');
    await this.checkDirectory();
    const pending = await this.io.lstat(path); this.budget.check();
    file(pending, this.profile.uid, this.profile.bytes.byteLength);
    if (!same(pending, this.fileIdentity!)) throw new PublicationError('integrity');
    try { await this.io.link(path, this.target); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new PublicationError('exists');
      throw error;
    }
    this.budget.check();
    await this.io.unlink(path); this.budget.check();
    const final = await this.io.lstat(this.target); this.budget.check();
    file(final, this.profile.uid, this.profile.bytes.byteLength);
    if (!same(final, this.fileIdentity!)) throw new PublicationError('integrity');
    await this.checkDirectory(); await this.parent!.sync(); this.budget.check();
    await this.checkDirectory();
  }
  private async checkDirectory(): Promise<void> {
    const named = await this.io.lstat(this.profile.directory); this.budget.check();
    const opened = await this.parent!.stat(); this.budget.check();
    directory(named, this.profile.uid); directory(opened, this.profile.uid);
    if (!same(named, opened) || !same(opened, this.parentIdentity!)) throw new PublicationError('integrity');
  }
  private closeFile(): Promise<void> {
    if (this.fileClose) return this.fileClose;
    const handle = this.pending;
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
