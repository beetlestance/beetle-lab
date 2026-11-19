import { constants } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import {
  decodeK6HistoryCheckpoint,
  K6_HISTORY_CHECKPOINT_NAMES,
  K6_HISTORY_CHECKPOINT_SLOT_BYTES,
} from '@beetle/contracts/k6-live';
import type { K6LiveApproval } from '@beetle/contracts/k6-live';
import type { LiveMetricArchivePrefix } from '@beetle/contracts/api';
import { OutputFailure } from '../output/index.js';
import type { OutputIO, OutputPorts } from '../output/index.js';
import type { CollectionRootIdentity } from '../root/index.js';
import { exactRoot, sameEntry } from './stopped-identity.js';

export const historyHash = (text: string) => createHash('sha256').update(text).digest('hex');
type Options = {
  readonly root: CollectionRootIdentity;
  readonly approval: K6LiveApproval;
  readonly maximumBytes: number;
};

export class StoppedSlots {
  private readonly entries = new Map<string, BigIntStats | undefined>();
  constructor(
    private readonly options: Options,
    private readonly ports: OutputPorts,
    private readonly io: OutputIO,
  ) {}
  async select(): Promise<LiveMetricArchivePrefix> {
    await this.checkRoot();
    const candidates: LiveMetricArchivePrefix[] = [];
    for (const name of K6_HISTORY_CHECKPOINT_NAMES) {
      const bytes = await this.read(join(this.options.root.directory, name));
      if (!bytes) continue;
      const prefix = decodeK6HistoryCheckpoint(bytes, this.options.approval, historyHash);
      if (prefix && this.fits(prefix)) candidates.push(prefix);
    }
    await this.check();
    candidates.sort((left, right) => right.windows - left.windows);
    const [latest, earlier] = candidates;
    if (!latest) throw new OutputFailure('missing');
    if (earlier && !advances(earlier, latest)) throw new OutputFailure('integrity');
    return latest;
  }
  private fits(prefix: LiveMetricArchivePrefix): boolean {
    const bytes = prefix.data.bytes + prefix.index.bytes + (prefix.target?.data.bytes ?? 0);
    return bytes + K6_HISTORY_CHECKPOINT_NAMES.length * K6_HISTORY_CHECKPOINT_SLOT_BYTES <= this.options.maximumBytes;
  }
  private async checkRoot(): Promise<void> {
    const { root } = this.options;
    if ((await this.io.io(() => this.ports.realpath(root.directory))) !== root.directory)
      throw new OutputFailure('custody');
    exactRoot(root, await this.io.io(() => this.ports.lstat(root.directory, { bigint: true })));
  }
  async check(): Promise<void> {
    await this.checkRoot();
    for (const [path, stat] of this.entries) {
      const current = await this.named(path);
      if (stat === undefined && current === undefined) continue;
      if (!stat || !current || !sameEntry(stat, current)) throw new OutputFailure('custody');
    }
    await this.checkRoot();
  }
  private async named(path: string): Promise<BigIntStats | undefined> {
    try {
      return await this.io.io(() => this.ports.lstat(path, { bigint: true }));
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
      throw error;
    }
  }
  private requireSlot(stat: BigIntStats): void {
    if (
      !stat.isFile() ||
      stat.nlink !== 1n ||
      stat.uid !== BigInt(this.options.root.uid) ||
      (stat.mode & 0o7777n) !== 0o600n ||
      stat.size > BigInt(K6_HISTORY_CHECKPOINT_SLOT_BYTES)
    )
      throw new OutputFailure('custody');
  }
  private async read(path: string): Promise<Buffer | undefined> {
    const stat = await this.named(path);
    this.entries.set(path, stat);
    if (!stat) return undefined;
    this.requireSlot(stat);
    const handle = await this.io.io(async () => {
      const native = await this.ports.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      this.io.own(native);
      return native;
    });
    const check = async () => {
      const observed = await this.io.io(() => handle.stat({ bigint: true }));
      this.requireSlot(observed);
      if (!sameEntry(stat, observed)) throw new OutputFailure('custody');
    };
    await check();
    const buffer = Buffer.alloc(Number(stat.size));
    for (let position = 0, calls = 0; position < buffer.length; calls++) {
      if (calls >= 32) throw new OutputFailure('integrity');
      const length = buffer.length - position;
      const { bytesRead } = await this.io.io(() => handle.read({ buffer, offset: position, length, position }));
      if (!Number.isSafeInteger(bytesRead) || bytesRead < 1 || bytesRead > length) throw new OutputFailure('integrity');
      position += bytesRead;
    }
    await check();
    return buffer;
  }
}

function advances(earlier: LiveMetricArchivePrefix, later: LiveMetricArchivePrefix): boolean {
  return (
    earlier.windows < later.windows &&
    earlier.endTimeMs < later.endTimeMs &&
    (['data', 'index'] as const).every(
      (lane) =>
        earlier[lane].artifactId.toLowerCase() === later[lane].artifactId.toLowerCase() &&
        earlier[lane].bytes < later[lane].bytes,
    )
  );
}
