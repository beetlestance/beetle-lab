import { isAbsolute, normalize } from 'node:path';
import type { BigIntStats } from 'node:fs';
import { copyControlScope, copyWrapperCheckpoint, copyWrapperCursor } from '../../control-protocol/index.js';
import type { WrapperBatch, WrapperCheckpoint } from '../../control-protocol/index.js';
import { CONTROL_READ_BYTES, CONTROL_READ_CALLS, ControlReadError } from './types.js';
import type { ControlReadBudget, ControlReadOperation, ControlReader, ControlReaderOptions, ControlReadValue } from './types.js';
import { nodePorts } from './ports.js';
import type { ReaderPorts } from './ports.js';
import { immediate, Operation } from './operation.js';
import { Custody, signature } from './custody.js';
import { Frames } from './frames.js';
import { Verification } from './verification.js';

function validDirectory(directory: unknown): directory is string {
  return typeof directory === 'string' && Buffer.byteLength(directory) <= 4096 && !directory.includes('\0')
    && isAbsolute(directory) && normalize(directory) === directory;
}
function optionsCopy(input: ControlReaderOptions): ControlReaderOptions {
  try {
    const { directory, uid, key, checkpoint } = input;
    if (!validDirectory(directory)) throw new Error();
    if (!Number.isSafeInteger(uid) || uid < 0 || uid > 4_294_967_295) throw new Error();
    if (Object.keys(input).sort().join(',') !== 'checkpoint,directory,key,uid') throw new Error();
    return Object.freeze({ directory, uid, key: copyControlScope(key),
      checkpoint: checkpoint === null ? null : copyWrapperCheckpoint(checkpoint) });
  } catch { throw new ControlReadError('invalid_options'); }
}
/** Private constructor permits fault testing; the public factory always uses Node FS. */
export class Reader implements ControlReader {
  private readonly options: ControlReaderOptions;
  private readonly custody: Custody;
  private readonly frames = new Frames();
  private checkpoint: Readonly<WrapperCheckpoint> | null;
  private pending: Readonly<WrapperBatch> | null = null;
  private active: { op: Operation; quiesced: Promise<void> } | undefined;
  private closing: Promise<void> | undefined;
  private closed = false;
  private fatal: ControlReadError | undefined;
  private verification: Verification | undefined;
  private restarted: boolean;
  private finalSignature: string | undefined;
  constructor(options: ControlReaderOptions, private readonly ports: ReaderPorts = nodePorts) {
    this.options = optionsCopy(options); this.checkpoint = this.options.checkpoint;
    this.restarted = this.checkpoint === null;
    this.custody = new Custody(this.options.directory, this.options.uid, ports);
  }
  read(input: ControlReadBudget): ControlReadOperation {
    if (this.closed) return immediate('closed');
    if (this.active) return immediate('busy');
    const op = new Operation(this.ports); const operation = op.operation;
    this.active = { op, quiesced: operation.quiesced };
    op.run(input, () => this.work(op), () => { this.active = undefined; });
    return operation;
  }
  private async work(op: Operation): Promise<ControlReadValue> {
    if (this.fatal) throw this.fatal;
    if (this.pending) return { kind: 'batch', request: this.pending };
    try { return await this.collect(op); }
    catch (error) {
      this.fatal = error instanceof ControlReadError ? error : new ControlReadError('io');
      throw this.fatal;
    }
  }
  private async collect(op: Operation): Promise<ControlReadValue> {
    const stat = await this.custody.ensure(op);
    if (!stat) {
      if (this.checkpoint || op.budget.stopped) throw new ControlReadError('missing');
      return this.caughtUp();
    }
    this.checkIdentity(stat);
    if (!this.restarted) return this.restart(op, stat);
    if (this.verification?.phase === 'final') return this.resumeFinal(op, stat);
    const batch = await this.intake(op, stat);
    const observed = await this.custody.check(op);
    if (batch) { this.pending = batch; this.finalSignature = undefined; return { kind: 'batch', request: batch }; }
    if (op.budget.stopped) return this.stopped(op, observed);
    return this.caughtUp();
  }
  private resumeFinal(op: Operation, stat: BigIntStats): Promise<ControlReadValue> | ControlReadValue {
    if (op.budget.stopped) return this.final(op, stat);
    this.verification = undefined; return this.caughtUp();
  }
  private stopped(op: Operation, stat: BigIntStats): Promise<ControlReadValue> | ControlReadValue {
    if (this.frames.position < Number(stat.size)) return this.caughtUp();
    if (this.frames.incomplete) throw new ControlReadError('corruption');
    if (this.checkpoint) return this.final(op, stat);
    return this.caughtUp();
  }
  private checkIdentity(stat: BigIntStats): void {
    if (!this.checkpoint) return;
    if (stat.dev.toString() !== this.checkpoint.dev || stat.ino.toString() !== this.checkpoint.ino) {
      throw new ControlReadError('custody');
    }
    if (stat.size < BigInt(this.checkpoint.offset)) throw new ControlReadError('corruption');
  }
  private async restart(op: Operation, stat: BigIntStats): Promise<ControlReadValue> {
    this.verification ??= new Verification('restart', this.checkpoint!, stat);
    const outcome = await this.verification.pass(this.custody, op);
    if ('kind' in outcome) return outcome;
    this.frames.restore(this.checkpoint!, outcome); this.restarted = true; this.verification = undefined;
    return { kind: 'verifying', phase: 'restart', verifiedBytes: this.checkpoint!.offset,
      targetBytes: this.checkpoint!.offset };
  }
  private async intake(op: Operation, stat: BigIntStats): Promise<Readonly<WrapperBatch> | null> {
    let batch: Readonly<WrapperBatch> | null = null;
    while (!this.frames.full(batch)) {
      op.check();
      if (this.frames.buffered) {
        const candidate = this.frames.append({ key: this.options.key, expected: this.checkpoint,
          identity: { dev: stat.dev.toString(), ino: stat.ino.toString() }, batch });
        if (candidate) { batch = candidate; continue; }
        if (this.frames.buffered) break;
      }
      if (op.calls >= CONTROL_READ_CALLS || op.bytes >= CONTROL_READ_BYTES) break;
      this.frames.prepareRead();
      const bytes = await this.custody.read(op, this.frames.position, Math.min(65_536, CONTROL_READ_BYTES - op.bytes));
      if (bytes.length === 0) break;
      this.frames.load(bytes);
    }
    return batch;
  }
  private async final(op: Operation, stat: BigIntStats): Promise<ControlReadValue> {
    this.verification?.matches(stat);
    if (stat.size !== BigInt(this.checkpoint!.offset)) return this.caughtUp();
    if (this.finalSignature === signature(stat)) return this.verified();
    this.verification ??= new Verification('final', this.checkpoint!, stat);
    const outcome = await this.verification.pass(this.custody, op);
    if ('kind' in outcome) return outcome;
    this.verification = undefined; this.finalSignature = signature(stat); return this.verified();
  }
  private verified(): ControlReadValue {
    return { kind: 'caught_up', cursor: this.checkpoint!, tail: 'none', consistency: 'stopped_verified' };
  }
  private caughtUp(): ControlReadValue {
    return { kind: 'caught_up', cursor: this.checkpoint, tail: this.frames.incomplete ? 'incomplete' : 'none',
      consistency: 'live_provisional' };
  }
  accept(input: Readonly<WrapperCheckpoint>): void {
    try {
      if (this.closed || !this.pending) throw new Error();
      const checkpoint = copyWrapperCheckpoint(input);
      const cursor = copyWrapperCursor({ version: checkpoint.version, dev: checkpoint.dev, ino: checkpoint.ino,
        offset: checkpoint.offset, wrapperSeq: checkpoint.wrapperSeq, prefixSha256: checkpoint.prefixSha256 });
      if (JSON.stringify(cursor) !== JSON.stringify(this.pending.next)) throw new Error();
      this.checkpoint = checkpoint; this.pending = null;
    } catch { throw new ControlReadError('checkpoint'); }
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true; this.active?.op.stop();
    this.closing = Promise.resolve(this.active?.quiesced).then(() => this.custody.close());
    return this.closing;
  }
}
export function createControlReader(options: ControlReaderOptions): ControlReader { return new Reader(options); }
