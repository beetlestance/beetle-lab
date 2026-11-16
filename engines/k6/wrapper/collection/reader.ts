import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { createHash } from 'node:crypto';
import type { Budget } from './budget.js';
import { SummaryError } from './types.js';
import type { SummaryOptions } from './types.js';

const maximum = 1_048_576;
function fail(): never { throw new SummaryError('filesystem'); }
function regular(stat: Stats, uid: number): void {
  if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== uid || (stat.mode & 0o022) !== 0) fail();
  if (!Number.isSafeInteger(stat.size) || stat.size < 0 || stat.size > maximum) throw new SummaryError('limit');
}
function same(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size
    && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}
export class Reader {
  private handle: FileHandle | undefined;
  private closing: Promise<void> | undefined;
  constructor(private readonly options: SummaryOptions, private readonly budget: Budget) {}
  private async parent(): Promise<Stats> {
    const path = this.options.outputDirectory;
    if (!isAbsolute(path) || !Number.isSafeInteger(this.options.uid) || this.options.uid < 0) fail();
    this.budget.check();
    if (await realpath(path) !== path) fail();
    this.budget.check();
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== this.options.uid || (stat.mode & 0o077) !== 0) fail();
    return stat;
  }
  async read(): Promise<{ bytes: Uint8Array; sha256: string }> {
    const parent = await this.parent(); this.budget.check();
    const path = join(this.options.outputDirectory, 'beetle-evidence.json');
    const before = await lstat(path); regular(before, this.options.uid); this.budget.check();
    this.handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    this.budget.check();
    const stat = await this.handle.stat(); regular(stat, this.options.uid);
    if (!same(before, stat)) throw new SummaryError('integrity');
    const bytes = new Uint8Array(stat.size);
    await this.content(bytes);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const verify = new Uint8Array(stat.size); await this.content(verify);
    if (createHash('sha256').update(verify).digest('hex') !== sha256) throw new SummaryError('integrity');
    this.budget.check();
    const after = await this.handle.stat(); regular(after, this.options.uid);
    this.budget.check();
    const named = await lstat(path); regular(named, this.options.uid);
    const finalParent = await this.parent();
    if (!same(stat, after) || !same(stat, named) || parent.dev !== finalParent.dev || parent.ino !== finalParent.ino) {
      throw new SummaryError('integrity');
    }
    this.budget.check(); return { bytes, sha256 };
  }
  private async content(bytes: Uint8Array): Promise<void> {
    let offset = 0;
    for (let calls = 0; calls < 31 && offset < bytes.length; calls++) {
      this.budget.check();
      const read = await this.handle!.read(bytes, offset, Math.min(65_536, bytes.length - offset), offset);
      if (read.bytesRead < 1) throw new SummaryError('integrity');
      offset += read.bytesRead;
    }
    if (offset !== bytes.length) throw new SummaryError('limit');
    this.budget.check();
    if ((await this.handle!.read(new Uint8Array(1), 0, 1, offset)).bytesRead !== 0) throw new SummaryError('integrity');
  }
  close(): Promise<void> {
    this.closing ??= Promise.resolve().then(async () => { await this.handle?.close(); });
    return this.closing;
  }
}
