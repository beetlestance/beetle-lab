import { createHash, randomUUID } from 'node:crypto';
import { encodeJson } from '@beetle/contracts';
import { captureTargetRuntimeReport } from '@beetle/contracts/target-runtime';
import type { TargetRuntimeSample } from '@beetle/contracts/target-runtime';
import type { JournalScope } from '../control/index.js';
import { AppendFiles } from '../artifact-custody/index.js';
import { AttemptError } from '../failure/index.js';

const maximumBytes = 1_048_576;
export interface TargetArchiveOptions {
  readonly directory: string;
  readonly uid: number;
  readonly scope: JournalScope;
  readonly intervalMs: number;
  readonly allowance: number;
  readonly check: () => void;
}
/** Completed advisory bytes only, never adopted output or durability authority. */
export type { LiveTargetArchivePrefix as TargetArchivePrefix } from '@beetle/contracts/api';
import type { LiveTargetArchivePrefix as TargetArchivePrefix } from '@beetle/contracts/api';
class ArchiveBusy extends AttemptError {
  readonly code = 'busy';
  constructor() {
    super('artifact');
  }
}

/** One serial append original, one fixed file, no retained sample corpus or write queue. */
export class TargetArchive {
  private files: AppendFiles | undefined;
  private readonly artifactId = randomUUID();
  private readonly hash = createHash('sha256');
  private charged = 0;
  private completedBytes = 0;
  private count = 0;
  private prefix: TargetArchivePrefix | undefined;
  private active: Promise<void> | undefined;
  private closing: Promise<void> | undefined;
  private fault: AttemptError | undefined;
  private constructor(private readonly options: TargetArchiveOptions) {}
  static async create(options: TargetArchiveOptions): Promise<TargetArchive> {
    const captured = Object.freeze({
      ...options,
      scope: Object.freeze({ ...options.scope }),
      check: options.check.bind(options),
    });
    if (
      !Number.isSafeInteger(captured.allowance) ||
      captured.allowance < 1024 ||
      captured.allowance > maximumBytes ||
      !Number.isSafeInteger(captured.intervalMs) ||
      captured.intervalMs < 1000 ||
      captured.intervalMs > 60000
    )
      throw new AttemptError('output_limit');
    const owner = new TargetArchive(captured);
    try {
      await owner.initialize();
      return owner;
    } catch (error) {
      await owner.close();
      throw error;
    }
  }
  get bytes(): number {
    return this.charged;
  }
  get quiescence(): 'confirmed' | 'failed' {
    return this.files?.quiescence ?? 'confirmed';
  }
  completedPrefix(): TargetArchivePrefix | undefined {
    try {
      this.check();
      return this.prefix;
    } catch {
      return undefined;
    }
  }
  syncPrefix(): Promise<void> {
    this.check();
    return this.files!.sync('data');
  }
  private check(): void {
    this.options.check();
    if (this.closing || this.fault) throw this.fault ?? new AttemptError('artifact');
  }
  private async initialize(): Promise<void> {
    this.files = await AppendFiles.create({
      root: this.options.directory,
      uid: this.options.uid,
      profile: 'target',
      check: () => this.check(),
    });
    await this.write({
      format: 'beetle-target-samples',
      version: 1,
      scope: this.options.scope,
      artifactId: this.artifactId,
      intervalMs: this.options.intervalMs,
    });
  }
  private async write(value: unknown): Promise<void> {
    const bytes = Buffer.from(encodeJson(value, 16_383) + '\n');
    if (this.charged + bytes.byteLength > this.options.allowance) throw new AttemptError('output_limit');
    this.charged += bytes.byteLength;
    await this.files!.append('data', bytes);
    this.hash.update(bytes);
    this.completedBytes += bytes.byteLength;
  }
  append(sample: TargetRuntimeSample): Promise<void> {
    if (this.active) return Promise.reject(new ArchiveBusy());
    let captured: TargetRuntimeSample;
    try {
      this.check();
      if (this.count >= 256) throw new AttemptError('output_limit');
      captured = captureTargetRuntimeReport({
        format: 'beetle-target-runtime',
        version: 1,
        scope: 'target-reported',
        samples: [sample],
        limited: false,
        missed: sample.status === 'unavailable' ? 1 : 0,
      }).samples[0]!;
    } catch (error) {
      this.fault ??= error instanceof AttemptError ? error : new AttemptError('artifact');
      return Promise.reject(this.fault);
    }
    const original = Promise.resolve()
      .then(async () => {
        this.check();
        await this.write({ kind: 'sample', sequence: this.count + 1, sample: captured });
        this.count++;
        this.prefix = Object.freeze({
          scope: this.options.scope,
          intervalMs: this.options.intervalMs,
          samples: this.count,
          data: Object.freeze({
            artifactId: this.artifactId,
            relativePath: 'target-samples.ndjson' as const,
            bytes: this.completedBytes,
            sha256: this.hash.copy().digest('hex'),
          }),
        });
      })
      .catch((error) => {
        this.fault ??= error instanceof AttemptError ? error : new AttemptError('artifact');
        throw this.fault;
      })
      .finally(() => {
        this.active = undefined;
      });
    this.active = original;
    return original;
  }
  close(): Promise<void> {
    this.closing ??= Promise.resolve().then(async () => {
      await Promise.allSettled([this.active]);
      await this.files?.close();
    });
    return this.closing;
  }
}
