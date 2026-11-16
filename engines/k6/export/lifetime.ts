import { performance } from 'node:perf_hooks';
import { exportStandaloneScript } from './builder.js';
import { captureOptions } from './options.js';
import { StandaloneExportError } from './types.js';
import type { StandaloneExportInput, StandaloneExportOutput } from './types.js';
import { StandaloneBuildError } from './lifetime-types.js';
import type { StandaloneBuildCode, StandaloneBuildInput, StandaloneBuildOperation } from './lifetime-types.js';
const maximumDuration = 172_800_000;
function context(input: StandaloneBuildInput) {
  const signal = Object.getOwnPropertyDescriptor(input,'signal'); const deadline = Object.getOwnPropertyDescriptor(input,'deadline');
  if (!signal || !('value' in signal) || !(signal.value instanceof AbortSignal) || !deadline || !('value' in deadline)
    || typeof deadline.value !== 'number' || !Number.isFinite(deadline.value) || deadline.value < 0 || deadline.value > Number.MAX_SAFE_INTEGER) throw new StandaloneBuildError('invalid_input');
  return {signal: signal.value as AbortSignal, deadline: deadline.value as number};
}
function failure(error: unknown): StandaloneBuildError {
  if (error instanceof StandaloneBuildError) return error;
  return new StandaloneBuildError(error instanceof StandaloneExportError ? error.code : 'build_failed');
}
class Build implements StandaloneBuildOperation {
  readonly result: Promise<StandaloneExportOutput>;
  readonly settled: Promise<void>;
  private reason: StandaloneBuildError | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private last = -1;
  private issued = false;
  private reject!: (reason: StandaloneBuildError) => void;
  private readonly stopped = new Promise<never>((_,reject) => {this.reject=reject;});
  private readonly abort = () => this.stop('cancelled');
  constructor(input: StandaloneExportInput, private readonly owner: {signal: AbortSignal; deadline: number}) {
    const original = Promise.resolve().then(() => {this.tick(); this.check(); this.issued=true; return exportStandaloneScript(input);})
      .catch(error => {this.reason ??= failure(error); throw error;});
    this.settled = original.then(() => undefined, error => {if (this.issued) throw failure(error);});
    this.result = Promise.race([original.then(value => {this.check(); return value;}),this.stopped])
      .catch(error => {throw this.reason ?? failure(error);}).finally(() => this.dispose());
    owner.signal.addEventListener('abort',this.abort,{once:true});
    if (owner.signal.aborted) this.abort();
    void this.stopped.catch(() => undefined); void this.result.catch(() => undefined); void this.settled.catch(() => undefined);
  }
  private check(): number {
    if (this.owner.signal.aborted) this.stop('cancelled'); if (this.reason) throw this.reason;
    const now=this.sample();
    if (now < this.last) this.stop('clock_fenced');
    this.last=now;
    if (this.owner.deadline-now > maximumDuration) this.stop('invalid_input');
    if (now >= this.owner.deadline) this.stop('deadline');
    if (this.reason) throw this.reason; return now;
  }
  private sample(): number {
    try {
      const now=performance.now();
      if (!Number.isFinite(now) || now < 0 || now > Number.MAX_SAFE_INTEGER-maximumDuration) throw new Error();
      return now;
    } catch {this.stop('clock_fenced'); throw this.reason;}
  }
  private tick(): void {
    try {const now=this.check(); this.timer=setTimeout(() => this.tick(),Math.max(1,Math.ceil(this.owner.deadline-now))); this.timer.unref();}
    catch {if (!this.reason) this.stop('clock_fenced');}
  }
  private stop(code: StandaloneBuildCode): void {
    this.reason ??= new StandaloneBuildError(code); clearTimeout(this.timer); this.reject(this.reason);
  }
  private dispose(): void {clearTimeout(this.timer); this.owner.signal.removeEventListener('abort',this.abort);}
  close(): Promise<void> {this.stop('closed'); return this.settled;}
}
/** Caller must retain the opaque original and later obtain physical stop/custody proof. */
export function startStandaloneBuild(input: StandaloneBuildInput): StandaloneBuildOperation {
  const captured = captureOptions(input); const owner=context(input);
  return new Build(Object.freeze({suite:captured.suite, outputDirectory:captured.outputDirectory,
    timeoutMs:captured.attempt.timeoutMs, maximumBuildBytes:captured.maximumBuildBytes}),owner);
}
