import { createHash, randomUUID } from 'node:crypto';
import type { Hash } from 'node:crypto';
import type { BigIntStats } from 'node:fs';
import { encodeJson } from '@beetle/contracts';
import type { EngineResult } from '@beetle/contracts';
import type { MetricWindow } from '../../../aggregation/index.js';
import type { JournalScope } from '../../control/index.js';
import type { AttemptFence } from '../../lifecycle/index.js';
import { AttemptError } from '../types.js';
import { MetricFiles, names } from './files.js';
import type { Lane } from './files.js';

const footerReserve = 1024;
export interface ArchiveOptions { directory: string; uid: number; allowance: number; scope: JournalScope; fence: Pick<AttemptFence, 'check' | 'timestamp'> }
export interface ArchiveEvidence {
  readonly artifacts: readonly EngineResult['artifacts'][number][];
  readonly windows: number;
  readonly dataArtifactId: string;
  readonly indexArtifactId: string;
  readonly bytes: number;
}
interface Position { bytes: number; hash: Hash }
class ArchiveBusy extends AttemptError {
  readonly code = 'busy';
  constructor() { super('artifact'); }
}

/** One record in flight, two fixed files, constant-size indexing state. */
export class MetricArchive {
  private files: MetricFiles | undefined;
  private readonly dataId = randomUUID();
  private readonly indexId = randomUUID();
  private readonly positions: Record<Lane, Position> = {
    data: { bytes: 0, hash: createHash('sha256') }, index: { bytes: 0, hash: createHash('sha256') },
  };
  private count = 0;
  private through = -1;
  private charged = 0;
  private ceiling: number;
  private collecting = false;
  private active: Promise<unknown> | undefined;
  private closing: Promise<void> | undefined;
  private fenced = false;
  private poisoned = false;
  private sealed: ArchiveEvidence | undefined;
  private fault: AttemptError | undefined;
  private constructor(private readonly options: ArchiveOptions) { this.ceiling = options.allowance; }
  static async create(options: ArchiveOptions): Promise<MetricArchive> {
    const captured = Object.freeze({ directory: options.directory, uid: options.uid, allowance: options.allowance,
      scope: Object.freeze({ ...options.scope }), fence: Object.freeze({
        check: options.fence.check.bind(options.fence), timestamp: options.fence.timestamp.bind(options.fence),
      }) });
    if (!Number.isSafeInteger(captured.allowance) || captured.allowance < 65536 || captured.allowance > 268435456) throw new AttemptError('output_limit');
    const owner = new MetricArchive(captured);
    try { await owner.initialize(); return owner; }
    catch (error) { await owner.close(); throw error; }
  }
  get bytes(): number { return this.positions.data.bytes + this.positions.index.bytes; }
  get failure(): AttemptError | undefined { return this.fault; }
  beginCollection(allowance: number): void {
    this.check();
    if (this.active) throw new ArchiveBusy();
    if (this.collecting || !Number.isSafeInteger(allowance) || !Number.isSafeInteger(this.charged + allowance)
      || allowance < footerReserve) throw new AttemptError('output_limit');
    this.collecting = true; this.ceiling = Math.min(this.ceiling, this.charged + allowance);
  }
  get quiescence(): 'confirmed' | 'failed' { return this.files?.quiescence ?? 'confirmed'; }
  private check(): void {
    this.options.fence.check();
    if (this.fenced || this.poisoned || this.sealed) throw this.failure ?? new AttemptError('artifact');
  }
  private record(value: unknown, maximum: number): Buffer {
    try { return Buffer.from(encodeJson(value, maximum - 1) + '\n'); }
    catch { throw new AttemptError('output_limit'); }
  }
  private async initialize(): Promise<void> {
    this.files = await MetricFiles.create({ root: this.options.directory, uid: this.options.uid, check: () => this.check() });
    for (const lane of ['data', 'index'] as const) {
      await this.write(lane, this.record({ format: lane === 'data' ? 'beetle-k6-metric-windows' : 'beetle-k6-metric-index',
        version: 1, scope: this.options.scope, dataArtifactId: this.dataId }, 1024));
    }
  }
  private reserve(bytes: number, final = false): void {
    const next = this.charged + bytes;
    if (!Number.isSafeInteger(next) || next + (final ? 0 : footerReserve) > this.ceiling) throw new AttemptError('output_limit');
    this.charged = next;
  }
  private async write(lane: Lane, bytes: Buffer, final = false): Promise<void> {
    this.reserve(bytes.byteLength, final);
    await this.files!.append(lane, bytes);
    this.positions[lane].hash.update(bytes); this.positions[lane].bytes += bytes.byteLength;
  }
  private run<T>(work: () => Promise<T>): Promise<T> {
    if (this.active) return Promise.reject(new ArchiveBusy());
    const original = Promise.resolve().then(() => { this.check(); return work(); }).catch(error => {
      this.poisoned = true; this.fault = error instanceof AttemptError ? error : new AttemptError('artifact');
      throw this.failure;
    }).finally(() => { this.active = undefined; });
    this.active = original; return original;
  }
  append(window: MetricWindow): Promise<void> {
    return this.run(async () => {
      const { startTimeMs: start, endTimeMs: end } = window;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start < this.through || end - start !== 1000) throw new AttemptError('artifact');
      if (this.count === 65536) throw new AttemptError('output_limit');
      const sequence = this.count + 1;
      const data = this.record({ kind: 'window', sequence, window }, 1_048_576);
      const index = this.record({ sequence, startTimeMs: start, endTimeMs: end, offset: this.positions.data.bytes, length: data.byteLength }, 256);
      if (this.charged + data.byteLength + index.byteLength + footerReserve > this.ceiling) throw new AttemptError('output_limit');
      await this.write('data', data); await this.write('index', index);
      this.count = sequence; this.through = end;
    });
  }
  finish(): Promise<ArchiveEvidence> {
    if (this.sealed) return Promise.resolve(this.sealed);
    return this.run(async () => {
      await this.write('data', this.record({ kind: 'end', windows: this.count }, 256), true);
      const dataSha256 = this.positions.data.hash.copy().digest('hex');
      await this.write('index', this.record({ kind: 'end', windows: this.count,
        dataBytes: this.positions.data.bytes, dataSha256 }, 256), true);
      const stats = new Map<Lane, BigIntStats>();
      for (const lane of ['data', 'index'] as const) {
        stats.set(lane, await this.files!.verify(lane, { bytes: this.positions[lane].bytes, sha256: this.positions[lane].hash.copy().digest('hex') }));
      }
      await this.files!.syncParent(); await this.files!.close();
      await this.files!.verifyNames(stats); this.check();
      this.sealed = Object.freeze({ windows: this.count, dataArtifactId: this.dataId, indexArtifactId: this.indexId,
        bytes: this.bytes, artifacts: Object.freeze(this.descriptors()) });
      return this.sealed;
    });
  }
  private descriptors(): EngineResult['artifacts'] {
    return (['data', 'index'] as const).map(lane => Object.freeze({ artifactId: lane === 'data' ? this.dataId : this.indexId,
      kind: lane === 'data' ? 'metric-windows' : 'metric-index', relativePath: names[lane], bytes: this.positions[lane].bytes,
      sha256: this.positions[lane].hash.copy().digest('hex'), sealedAt: this.options.fence.timestamp() }));
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.fenced = true;
    this.closing = Promise.resolve().then(async () => {
      await Promise.allSettled([this.active]); await this.files?.close();
    });
    return this.closing;
  }
}
