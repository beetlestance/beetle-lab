import type { CompiledInput } from '../input/index.js';
import type { JournalScope } from '../control/index.js';
import { startTargetSampling } from '../target-sampling/index.js';
import type { TargetSamplingOwner, TargetSamplingReport } from '../target-sampling/index.js';
import { TargetArchive } from '../target-archive/index.js';
import type { TargetArchivePrefix } from '../target-archive/index.js';
import { AttemptError } from './types.js';

interface Input {
  readonly suite: CompiledInput['suite'];
  readonly directory: string;
  readonly uid: number;
  readonly scope: JournalScope;
  readonly allowance: number;
  readonly signal: AbortSignal;
  readonly wall: () => number;
  readonly check: () => void;
}
/** Target sampling and its serial archive share one cleanup/collection owner. */
export class AttemptTarget {
  private sampler: TargetSamplingOwner | undefined;
  private archive: TargetArchive | undefined;
  private input: Input | undefined;
  private recording: Promise<void> | undefined;
  private closing: Promise<void> | undefined;
  private failed = false;
  private fault: AttemptError | undefined;
  private reportValue: TargetSamplingReport | undefined;
  get failure(): AttemptError | undefined {
    return this.fault;
  }
  get started(): boolean {
    return this.input !== undefined;
  }
  private readonly view = {
    recent: (limit: number) => this.sampler!.recent(limit),
    archivePrefix: () => this.completedPrefix(),
  };
  get source() {
    return this.sampler ? this.view : undefined;
  }
  get report(): TargetSamplingReport | undefined {
    return this.reportValue;
  }
  get bytes(): number {
    return this.archive?.bytes ?? 0;
  }
  get quiescence(): 'confirmed' | 'failed' {
    return this.failed || this.archive?.quiescence === 'failed' ? 'failed' : 'confirmed';
  }
  completedPrefix(): TargetArchivePrefix | undefined {
    return this.archive?.completedPrefix();
  }
  syncPrefix(): Promise<void> {
    if (!this.archive) throw new AttemptError('artifact');
    return this.archive.syncPrefix();
  }
  async start(input: Input): Promise<void> {
    if (!input.suite.targetSampling) return;
    if (this.input) throw new AttemptError('execution');
    this.input = input;
    try {
      this.sampler = await startTargetSampling({
        target: input.suite.target,
        config: input.suite.targetSampling,
        signal: input.signal,
        wall: input.wall,
        ...(input.allowance
          ? {
              record: async (sample) => {
                // Pre-measure samples stay in the sampler. Once recording starts, hold any
                // unretained observation behind its initial snapshot; no second sample queues.
                if (!this.recording) return;
                try {
                  await this.recording;
                  await this.archive!.append(sample);
                } catch (error) {
                  this.fail(error, 'artifact');
                }
              },
            }
          : {}),
      });
    } catch (error) {
      this.fail(error, 'cleanup');
    }
  }
  /** Called only after the execute transition: all archive bytes belong to execute. */
  startRecording(): Promise<void> {
    if (!this.input?.allowance || this.closing) return Promise.resolve();
    this.recording ??= Promise.resolve()
      .then(() => this.initializeArchive())
      .catch((error) => this.fail(error, 'artifact'));
    return this.recording;
  }
  private async initializeArchive(): Promise<void> {
    const input = this.input!;
    this.archive = await TargetArchive.create({
      directory: input.directory,
      uid: input.uid,
      scope: input.scope,
      intervalMs: input.suite.targetSampling!.intervalMs,
      allowance: input.allowance,
      check: input.check,
    });
    for (const sample of this.sampler!.recent(256)) await this.archive.append(sample);
  }
  async finish(): Promise<void> {
    try {
      this.reportValue = await this.sampler?.finish();
      await this.recording;
      await this.archive?.close();
    } catch (error) {
      this.fail(error, 'cleanup');
    }
  }
  private fail(error: unknown, fallback: 'artifact' | 'cleanup'): never {
    this.fault ??= error instanceof AttemptError ? error : new AttemptError(fallback);
    if (this.fault.reason === 'cleanup') this.failed = true;
    throw this.fault;
  }
  close(): Promise<void> {
    this.closing ??= Promise.resolve().then(async () => {
      // A sampler record can be waiting on archive initialization. Drain that exact
      // original before closing its file; a concurrent close would corrupt ownership.
      const sampled = await Promise.allSettled([this.sampler?.close(), this.recording]);
      const archived = await Promise.allSettled([this.archive?.close()]);
      if ([...sampled, ...archived].some((result) => result.status === 'rejected')) {
        this.failed = true;
        throw new AttemptError('cleanup');
      }
    });
    return this.closing;
  }
}
