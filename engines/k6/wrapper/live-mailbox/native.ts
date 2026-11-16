import { constants, type BigIntStats } from 'node:fs';
import { lstat, open, readdir, realpath, statfs, type FileHandle } from 'node:fs/promises';
import { LIVE_MAILBOX_PATH, MAILBOX_BYTES } from '@beetle/contracts/live-mailbox';
import type { MailboxFile } from './file.js';

export class NativeMailboxError extends Error {
  constructor(readonly code: 'invalid_options' | 'unsupported' | 'filesystem' | 'aborted' | 'closed' | 'busy' | 'cleanup', readonly owner?: MailboxFile) {
    super('Native live mailbox unavailable'); this.name = 'NativeMailboxError';
  }
}
function requireValue(value: unknown): asserts value {if (!value) throw new NativeMailboxError('filesystem');}
function directory(stat: BigIntStats, uid: number): void {
  requireValue(stat.isDirectory() && stat.uid === BigInt(uid) && (stat.mode & 0o777n) === 0o700n);
}
function file(stat: BigIntStats, uid: number): void {
  requireValue(stat.isFile() && stat.nlink === 1n && stat.uid === BigInt(uid) && (stat.mode & 0o777n) === 0o600n);
}
function check(signal: AbortSignal | undefined): void {if (signal?.aborted) throw new NativeMailboxError('aborted');}
/** Fixed production path, Linux-only. Caller must retain a failed cleanup owner. */
export async function openNativeMailbox(options: {uid: number; signal?: AbortSignal}): Promise<MailboxFile> {
  if (process.platform !== 'linux') throw new NativeMailboxError('unsupported');
  if (options.uid !== process.getuid?.() || options.signal !== undefined && !(options.signal instanceof AbortSignal)) throw new NativeMailboxError('invalid_options');
  const {parent, named} = await acquireDirectory(options.uid, options.signal);
  const owner = new NativeFile(parent, options.uid, options.signal);
  try {await owner.initialize(named); return owner;}
  catch (error) {
    try {await owner.close();} catch {throw new NativeMailboxError('cleanup', owner);}
    throw new NativeMailboxError(error instanceof NativeMailboxError && error.code === 'aborted' ? 'aborted' : 'filesystem');
  }
}
async function acquireDirectory(uid: number, signal: AbortSignal | undefined) {
  try {
    check(signal); const root = '/beetle/live';
    requireValue(await realpath(root) === root); const named = await lstat(root, {bigint: true}); directory(named, uid); check(signal);
    return {parent: await open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW), named};
  } catch (error) {throw new NativeMailboxError(error instanceof NativeMailboxError && error.code === 'aborted' ? 'aborted' : 'filesystem');}
}
class NativeFile implements MailboxFile {
  private file: FileHandle | undefined;
  private active: Promise<unknown> | undefined;
  private closing: Promise<void> | undefined;
  private directoryClose: Promise<void> | undefined;
  private fileClose: Promise<void> | undefined;
  constructor(private readonly parent: FileHandle, private readonly uid: number, private readonly signal: AbortSignal | undefined) {}
  initialize(named: BigIntStats): Promise<void> {
    return this.operation(async () => {
      const opened = await this.parent.stat({bigint: true}); directory(opened, this.uid);
      requireValue(opened.dev === named.dev && opened.ino === named.ino);
      const anchor = `/proc/self/fd/${this.parent.fd}`; const fs = await statfs(anchor, {bigint: true});
      requireValue(fs.type === 0x01021994n && fs.blocks * fs.bsize <= 131072n && fs.blocks * fs.bsize >= BigInt(MAILBOX_BYTES) && fs.files === 4n);
      requireValue((await readdir(anchor)).length === 0); check(this.signal);
      this.file = await open(`${anchor}/live-metrics.mailbox`, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
      file(await this.file.stat({bigint: true}), this.uid); check(this.signal);
      await this.file.truncate(MAILBOX_BYTES); check(this.signal);
      requireValue((await this.file.stat()).size === MAILBOX_BYTES);
      const current = await lstat('/beetle/live', {bigint: true}); directory(current, this.uid);
      requireValue(current.dev === named.dev && current.ino === named.ino);
      this.directoryClose = this.parent.close(); await this.directoryClose;
    });
  }
  size(): Promise<number> {
    return this.operation(async () => {const value = await this.handle().stat({bigint: true}); file(value, this.uid); return Number(value.size);});
  }
  write(bytes: Uint8Array, position: number): Promise<number> {
    return this.operation(async () => {
      requireValue(bytes instanceof Uint8Array && bytes.length > 0 && bytes.length <= 65536);
      requireValue(Number.isSafeInteger(position) && position >= 0 && position + bytes.length <= MAILBOX_BYTES);
      return (await this.handle().write(bytes, 0, bytes.length, position)).bytesWritten;
    });
  }
  private handle(): FileHandle {if (!this.file) throw new NativeMailboxError('closed'); return this.file;}
  private operation<T>(work: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new NativeMailboxError('closed'));
    if (this.active) return Promise.reject(new NativeMailboxError('busy'));
    const original = Promise.resolve().then(() => {check(this.signal); return work();}).finally(() => {this.active = undefined;});
    this.active = original; return original;
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    const active = this.active;
    this.closing = Promise.resolve().then(async () => {
      if (active) await active.catch(() => { /* Original failure already belongs to its caller. */ });
      this.fileClose ??= this.file ? this.file.close() : Promise.resolve();
      this.directoryClose ??= this.parent.close();
      const results = await Promise.allSettled([this.fileClose, this.directoryClose]);
      if (results.some(result => result.status === 'rejected')) throw new NativeMailboxError('cleanup', this);
    });
    return this.closing;
  }
}
export { LIVE_MAILBOX_PATH };
