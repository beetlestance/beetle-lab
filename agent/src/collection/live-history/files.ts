import { constants } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import type { LiveMetricArchivePrefix } from '@beetle/contracts/api';
import { OutputFailure } from '../output/index.js';
import type { OutputIO, OutputPorts } from '../output/index.js';

export type Lane = 'data' | 'index' | 'target';
interface Entry {
  path: string;
  stat: BigIntStats;
  handle: FileHandle;
  directory: boolean;
  minimum: number;
}
function identity(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}
/** Active files may append. Identity, ownership and minimum captured size may not change. */
export class PrefixFiles {
  private root: Entry | undefined;
  private readonly files = new Map<Lane, Entry>();
  constructor(
    private readonly options: { directory: string; uid: number; prefix: LiveMetricArchivePrefix },
    private readonly ports: OutputPorts,
    private readonly io: OutputIO,
  ) {}
  private metadata(stat: BigIntStats, directory: boolean, minimum: number): void {
    const kind = directory ? stat.isDirectory() : stat.isFile();
    if (
      !kind ||
      stat.uid !== BigInt(this.options.uid) ||
      (stat.mode & 0o7777n) !== (directory ? 0o700n : 0o600n) ||
      (!directory && (stat.nlink !== 1n || stat.size < BigInt(minimum)))
    )
      throw new OutputFailure('custody');
  }
  private async named(path: string, directory: boolean, minimum: number): Promise<BigIntStats> {
    if ((await this.io.io(() => this.ports.realpath(path))) !== path) throw new OutputFailure('custody');
    const stat = await this.io.io(() => this.ports.lstat(path, { bigint: true }));
    this.metadata(stat, directory, minimum);
    return stat;
  }
  private async openEntry(path: string, directory: boolean, minimum: number): Promise<Entry> {
    const stat = await this.named(path, directory, minimum);
    const flags =
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK | (directory ? constants.O_DIRECTORY : 0);
    const handle = await this.io.io(() =>
      this.ports.open(path, flags).then((value) => {
        this.io.own(value);
        return value;
      }),
    );
    const actual = await this.io.io(() => handle.stat({ bigint: true }));
    this.metadata(actual, directory, minimum);
    if (!identity(actual, stat)) throw new OutputFailure('custody');
    return { path, stat, handle, directory, minimum };
  }
  async open(): Promise<void> {
    if (this.root) throw new OutputFailure('invalid_options');
    this.root = await this.openEntry(this.options.directory, true, 0);
    for (const lane of ['data', 'index'] as const) {
      const prefix = this.options.prefix[lane];
      this.files.set(
        lane,
        await this.openEntry(join(this.options.directory, prefix.relativePath), false, prefix.bytes),
      );
    }
    const target = this.options.prefix.target;
    if (target)
      this.files.set(
        'target',
        await this.openEntry(join(this.options.directory, target.data.relativePath), false, target.data.bytes),
      );
    await this.check();
  }
  async check(namedOnly = false): Promise<void> {
    if (!this.root || this.files.size !== (this.options.prefix.target ? 3 : 2)) throw new OutputFailure('custody');
    for (const entry of [this.root, ...this.files.values()]) {
      const named = await this.named(entry.path, entry.directory, entry.minimum);
      if (!identity(named, entry.stat)) throw new OutputFailure('custody');
      if (!namedOnly) {
        const actual = await this.io.io(() => entry.handle.stat({ bigint: true }));
        this.metadata(actual, entry.directory, entry.minimum);
        if (!identity(actual, entry.stat)) throw new OutputFailure('custody');
      }
    }
  }
  async read(lane: Lane, buffer: Buffer, position: number): Promise<number> {
    const file = this.files.get(lane);
    if (!file || !Number.isSafeInteger(position) || position < 0 || position >= file.minimum)
      throw new OutputFailure('invalid_options');
    const length = Math.min(65536, buffer.length, file.minimum - position);
    if (!length) throw new OutputFailure('invalid_options');
    const { bytesRead } = await this.io.io(() => file.handle.read({ buffer, offset: 0, length, position }));
    if (!Number.isSafeInteger(bytesRead) || bytesRead <= 0 || bytesRead > length) throw new OutputFailure('integrity');
    return bytesRead;
  }
}
