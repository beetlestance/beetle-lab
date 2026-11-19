import { createHash } from 'node:crypto';
import { encodeK6HistoryCheckpoint, K6_HISTORY_CHECKPOINT_SLOT_BYTES } from '@beetle/contracts/k6-live';
import type { K6LiveApproval } from '@beetle/contracts/k6-live';
import type { LiveMetricArchivePrefix } from '@beetle/contracts/api';
import { AppendFiles } from '../artifact-custody/index.js';
import type { AppendLane } from '../artifact-custody/index.js';
import { AttemptError } from '../failure/index.js';

export const CHECKPOINT_ALLOWANCE = 2 * K6_HISTORY_CHECKPOINT_SLOT_BYTES;
const intervalMs = 5000;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

interface Options {
  readonly root: string;
  readonly uid: number;
  readonly approval: K6LiveApproval;
  readonly signal: AbortSignal;
  readonly monotonic: () => number;
  readonly sync: (target: boolean, check: () => void) => Promise<unknown>;
}

/** One write in flight. An incomplete write never truncates the last committed slot. */
export class HistoryCheckpoint {
  private files: AppendFiles | undefined;
  private lane: AppendLane = 'data';
  private next = Number.NEGATIVE_INFINITY;
  private lastWindow = 0;
  private active: Promise<void> | undefined;
  private closing: Promise<void> | undefined;
  private disabled = false;
  private cleanupFailed = false;
  private charge = 0;
  get chargedBytes(): number {
    return this.charge;
  }
  constructor(private readonly options: Options) {}
  publish(prefix: LiveMetricArchivePrefix): Promise<void> {
    if (this.active) return this.active;
    const now = this.clock();
    if (!Number.isFinite(now)) this.disabled = true;
    if (
      this.closing ||
      this.disabled ||
      this.options.signal.aborted ||
      now < this.next ||
      prefix.windows <= this.lastWindow
    )
      return Promise.resolve();
    this.next = now + intervalMs;
    this.active = this.write(prefix)
      .catch((error) => {
        this.disabled = true;
        if (error instanceof AttemptError && error.reason === 'cleanup') {
          this.cleanupFailed = true;
        }
      })
      .finally(() => {
        this.active = undefined;
      });
    return this.active;
  }
  private async write(prefix: LiveMetricArchivePrefix): Promise<void> {
    const { root, uid, approval } = this.options;
    const check = () => this.check();
    const bytes = encodeK6HistoryCheckpoint(prefix, approval, hash);
    if (!this.files) {
      this.charge = CHECKPOINT_ALLOWANCE;
      this.files = await AppendFiles.create({ root, uid, profile: 'checkpoint', check });
      await this.files.syncParent();
    }
    check();
    await this.options.sync(prefix.target !== undefined, check);
    check();
    await this.files.replaceCheckpoint(this.lane, bytes);
    this.lane = this.lane === 'data' ? 'index' : 'data';
    this.lastWindow = prefix.windows;
  }
  private clock(): number {
    try {
      return this.options.monotonic();
    } catch {
      return NaN;
    }
  }
  private check(): void {
    this.options.signal.throwIfAborted();
    if (this.closing) throw new AttemptError('artifact');
  }
  close(): Promise<void> {
    this.closing ??= this.drain();
    return this.closing;
  }
  private async drain(): Promise<void> {
    try {
      await this.active;
    } finally {
      await this.files?.close();
    }
    if (this.cleanupFailed) throw new AttemptError('cleanup');
  }
}
