import { closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync, realpathSync } from 'node:fs';
import type { Stats } from 'node:fs';
import { dirname, isAbsolute, normalize } from 'node:path';
import { InstallationStateError } from './types.js';
export const native = {openSync, closeSync, fstatSync, fsyncSync};
interface Descriptor {readonly fd: number; closeIssued: boolean; closed: boolean}
function valid(info: Stats): void {
  if (!info.isFile() || info.nlink !== 1 || info.size > 65536 || info.uid !== process.getuid?.() || (info.mode & 0o077)) throw new InstallationStateError('recovery_required');
}
function privateParent(path: string): Stats {
  if (typeof path !== 'string' || !isAbsolute(path) || path.length > 4096 || normalize(path) !== path || realpathSync(dirname(path)) !== dirname(path)) throw new InstallationStateError('invalid_input');
  const parent = lstatSync(dirname(path));
  if (!parent.isDirectory() || parent.uid !== process.getuid?.() || (parent.mode & 0o077)) throw new InstallationStateError('invalid_input');
  return parent;
}
/** Caller retains this owner BEFORE acquire can issue any native descriptor. */
export class ControlFiles {
  private readonly parent: Stats;
  private original?: Stats;
  private readonly descriptors: Descriptor[] = [];
  private failure?: InstallationStateError;
  private closed = false;
  constructor(private readonly path: string) {this.parent = privateParent(path);}
  private withDescriptor(flags: number, path: string, work: (fd: number) => void): void {
    if (this.closed || this.failure || this.descriptors.length >= 2) throw new InstallationStateError('unavailable');
    const fd = native.openSync(path, flags, 0o600);
    const descriptor = {fd, closeIssued: false, closed: false}; this.descriptors.push(descriptor);
    try {work(fd);} finally {this.closeDescriptor(descriptor);}
  }
  private closeDescriptor(descriptor: Descriptor): void {
    if (descriptor.closeIssued) throw this.failure ?? new InstallationStateError('unavailable');
    descriptor.closeIssued = true;
    try {native.closeSync(descriptor.fd); descriptor.closed = true;}
    catch {this.failure = new InstallationStateError('unavailable'); throw this.failure;}
  }
  acquire(create: boolean): void {
    if (this.original) throw new InstallationStateError('invalid_input');
    const flags = constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK | (create ? constants.O_CREAT | constants.O_EXCL : 0);
    this.withDescriptor(flags, this.path, fd => {
      this.original = native.fstatSync(fd); valid(this.original); if (create) native.fsyncSync(fd);
    });
  }
  syncParent(): void {
    this.check();
    this.withDescriptor(constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW, dirname(this.path), fd => native.fsyncSync(fd));
  }
  check(): void {
    if (this.closed) throw new InstallationStateError('closed');
    if (this.failure) throw this.failure;
    if (!this.original) throw new InstallationStateError('recovery_required');
    const current = lstatSync(this.path); const directory = privateParent(this.path); valid(current);
    if (current.dev !== this.original.dev || current.ino !== this.original.ino || directory.dev !== this.parent.dev || directory.ino !== this.parent.ino) throw new InstallationStateError('recovery_required');
  }
  close(): void {
    if (this.failure) throw this.failure;
    if (this.descriptors.some(descriptor => !descriptor.closed)) throw new InstallationStateError('unavailable');
    this.closed = true;
  }
}
