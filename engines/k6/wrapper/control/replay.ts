import type { ControlEvent } from '@beetle/contracts';
import { Operation, type OperationBudget } from './budget.js';
import { JournalError, safeError } from './errors.js';
import { assertFile, directoryPath, nodeJournalIo, readFlags } from './files.js';
import type { JournalFile, JournalIo } from './files.js';
import { FILE_BYTES, FRAME_BYTES, RECORDS, scopeSnapshot, validateEvent } from './frame.js';
import type { JournalScope } from './frame.js';

export interface ReplayOptions {
  readonly directory: string;
  readonly scope: JournalScope;
  readonly quotaBytes: number;
  readonly after: number;
  readonly io?: JournalIo;
}
export interface ReplayBatch {
  readonly events: readonly ControlEvent[];
  readonly nextCursor: number;
  readonly hasMore: boolean;
  /** Complete describes the scanned byte snapshot, never a terminal result/seal. */
  readonly state: 'complete' | 'torn_tail';
  readonly snapshotBytes: number;
  /** A reader cannot establish whether observed live bytes have been fsynced. */
  readonly durability: 'unverified';
}

class Scan {
  private readonly line = Buffer.alloc(FRAME_BYTES);
  private length = 0;
  private seq = 0;
  private batchBytes = 0;
  private full = false;
  private readonly events: ControlEvent[] = [];
  constructor(private readonly scope: JournalScope, private readonly after: number) {}

  consume(chunk: Buffer, length: number, operation: Operation): void {
    for (let index = 0; index < length; index++) {
      const byte = chunk[index];
      if (byte === 10) {
        this.record(); this.length = 0; operation.check();
      } else {
        if (this.length >= FRAME_BYTES - 1) throw new JournalError('corruption');
        this.line[this.length++] = byte ?? 0;
      }
    }
  }
  private record(): void {
    if (++this.seq > RECORDS) throw new JournalError('corruption');
    let event: ControlEvent;
    try {
      const json = new TextDecoder('utf-8', { fatal: true }).decode(this.line.subarray(0, this.length));
      event = validateEvent(JSON.parse(json) as unknown, this.scope);
    } catch { throw new JournalError('corruption'); }
    if (event.seq !== this.seq) throw new JournalError('corruption');
    if (this.seq <= this.after || this.full) return;
    const bytes = this.length + 1;
    if (this.events.length === 100 || this.batchBytes + bytes > 262_144) { this.full = true; return; }
    this.events.push(event); this.batchBytes += bytes;
  }
  result(snapshotBytes: number): ReplayBatch {
    if (this.after > this.seq) throw new JournalError('invalid_cursor');
    return Object.freeze({ events: Object.freeze(this.events),
      nextCursor: this.events.at(-1)?.seq ?? this.after, hasMore: this.full,
      state: this.length ? 'torn_tail' : 'complete', snapshotBytes, durability: 'unverified' });
  }
}

async function scanFile(file: JournalFile, options: ReplayOptions, operation: Operation): Promise<ReplayBatch> {
  const stat = await assertFile(file, operation); operation.check();
  if (stat.size > options.quotaBytes || stat.size > FILE_BYTES) throw new JournalError('quota_limit');
  const scan = new Scan(options.scope, options.after);
  const chunk = Buffer.alloc(FRAME_BYTES);
  let position = 0;
  while (position < stat.size) {
    operation.check();
    const requested = Math.min(chunk.length, stat.size - position);
    const { bytesRead } = await file.read(chunk, 0, requested, position); operation.check();
    if (!Number.isInteger(bytesRead) || bytesRead < 1 || bytesRead > requested) throw new JournalError('corruption');
    scan.consume(chunk, bytesRead, operation); position += bytesRead;
  }
  operation.check();
  return scan.result(stat.size);
}

async function replay(options: ReplayOptions, operation: Operation): Promise<ReplayBatch> {
  const io = options.io ?? nodeJournalIo;
  const path = await directoryPath(options.directory, io, operation); operation.check();
  const file = await io.open(path, readFlags);
  try { operation.check(); return await scanFile(file, options, operation); }
  finally { await file.close(); }
}

/** Corruption throws JournalError('corruption'); no successful partial batch is returned. */
export async function replayControl(options: ReplayOptions, budget: OperationBudget): Promise<ReplayBatch> {
  const scope = scopeSnapshot(options.scope);
  if (!Number.isSafeInteger(options.after) || options.after < 0 || options.after > RECORDS) {
    throw new JournalError('invalid_cursor');
  }
  if (!Number.isSafeInteger(options.quotaBytes) || options.quotaBytes < 1024 || options.quotaBytes > FILE_BYTES) {
    throw new JournalError('invalid_options');
  }
  const operation = new Operation(budget);
  const frozen = Object.freeze({ directory: options.directory, scope, after: options.after,
    quotaBytes: options.quotaBytes, io: options.io ?? nodeJournalIo });
  try { return await operation.wait(replay(frozen, operation)); }
  catch (error) { throw safeError(error); }
}
