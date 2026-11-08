import { join } from 'node:path';
import type { BuildOutput } from '../../build/index.js';
import type { MetricSnapshot } from '../../aggregation/index.js';
import type { NativeProcess, ProcessObservation } from '../process/index.js';
import type { SummaryCollection, SummaryResult } from '../collection/index.js';
import { Fence } from './fence.js';
import { Metrics } from './metrics.js';
import type { ExecutionPorts } from './ports.js';
import type { AcceptedOptions } from './profile.js';
import { ExecutionError } from './types.js';
import type { ExecutionCode, ExecutionOperation, ExecutionReceipt } from './types.js';

function terminal(observation: ProcessObservation): boolean {
  if (!observation.spawned) return observation.state === 'not_started' && observation.quiescent;
  return observation.state === 'stopped' && observation.groupAbsent && observation.stdioClosed && observation.quiescent;
}
function collectible(observation: ProcessObservation): boolean { return observation.spawned && terminal(observation); }

/** Owns one invocation and all original issued work; policy/outcome mapping lives elsewhere. */
export class Execution implements ExecutionOperation {
  readonly result: Promise<ExecutionReceipt>;
  readonly quiesced: Promise<void>;
  private readonly fence: Fence;
  private readonly ports: ExecutionPorts;
  private readonly work: Promise<ExecutionReceipt>;
  private phase: ExecutionCode = 'profile';
  private build: BuildOutput | null = null;
  private process: ProcessObservation | null = null;
  private terminalObservedAt: string | null = null;
  private summary: SummaryResult | null = null;
  private metrics: MetricSnapshot | null = null;
  private stream: Readonly<{ bytes: number; records: number }> | null = null;
  private numbers: Metrics | undefined;
  private native: NativeProcess | undefined;
  private collection: SummaryCollection | undefined;
  private nativeClosing: Promise<void> | undefined;
  private cleanup: Promise<void> | undefined;
  constructor(private readonly input: AcceptedOptions, ports: ExecutionPorts) {
    this.ports = Object.freeze({ build: ports.build, native: ports.native, summary: ports.summary });
    this.fence = new Fence(input);
    // Publish original-work ownership before clocks, factories or callbacks can reenter.
    this.work = Promise.resolve().then(() => this.perform());
    this.quiesced = this.work.then(() => this.clean());
    void this.quiesced.catch(() => undefined);
    const eligible = this.work.then(async receipt => {
      if (!receipt.ok) return receipt;
      try { await this.quiesced; return receipt; }
      catch { return this.receipt('cleanup'); }
    });
    this.result = this.fence.race(eligible).then(receipt => this.publish(receipt),
      error => this.publish(this.receipt(error instanceof ExecutionError ? error.code : 'cleanup')));
  }
  private receipt(code?: ExecutionCode): ExecutionReceipt {
    const evidence = { build: this.build, process: this.process, terminalObservedAt: this.terminalObservedAt,
      summary: this.summary, metrics: this.metrics, stream: this.stream, metricFailure: this.numbers?.failure ?? null };
    return Object.freeze(code ? { ...evidence, ok: false, code } : { ...evidence, ok: true });
  }
  private publish(receipt: ExecutionReceipt): ExecutionReceipt {
    try { this.fence.check(); }
    catch (error) { receipt = this.receipt(error instanceof ExecutionError ? error.code : 'clock'); }
    this.fence.dispose(); return receipt;
  }
  private async perform(): Promise<ExecutionReceipt> {
    try {
      this.fence.start();
      await this.buildScript();
      await this.execute();
      this.fence.check();
      return await this.collect();
    } catch (error) {
      return this.receipt(error instanceof ExecutionError ? error.code : this.phase);
    }
  }
  private async buildScript(): Promise<void> {
    this.phase = 'build'; this.fence.check();
    const built = await this.ports.build({ suite: this.input.compiled.suite, attempt: this.input.compiled.attempt,
      outputDirectory: this.input.outputDirectory, maximumBuildBytes: this.input.limits.maximumBuildBytes });
    this.build = Object.freeze({ scriptPath: built.scriptPath, bytes: built.bytes, peakBytes: built.peakBytes });
    this.fence.check();
    if (built.scriptPath !== join(this.input.outputDirectory, 'suite.js') || !Number.isSafeInteger(built.bytes)
      || !Number.isSafeInteger(built.peakBytes) || built.bytes < 1 || built.bytes > built.peakBytes
      || built.peakBytes > this.input.limits.maximumBuildBytes) throw new ExecutionError('build');
  }
  private async execute(): Promise<void> {
    this.phase = 'native'; this.fence.check();
    this.numbers = new Metrics(this.input, this.fence);
    this.fence.check();
    const native = this.ports.native({ binary: this.input.binary, emptyConfig: this.input.emptyConfig,
      directory: this.input.outputDirectory, script: this.build!.scriptPath, attempt: this.input.compiled.attempt,
      maxMetricStreamBytes: this.input.limits.maximumMetricBytes, maxDiagnosticBytes: this.input.limits.maximumDiagnosticBytes,
      drainTimeoutMs: this.input.limits.drainTimeoutMs, signal: this.fence.controller.signal, clock: this.input.clock,
      sink: (bytes, delivery) => this.numbers!.push(bytes, delivery.signal) });
    this.native = Object.freeze({ run: native.run.bind(native), close: native.close.bind(native) });
    this.fence.check();
    this.process = Object.freeze({ ...await this.native.run() });
    if (terminal(this.process)) this.terminalObservedAt = this.fence.terminalTime();
    this.fence.check();
  }
  private async collect(): Promise<ExecutionReceipt> {
    if (!this.process || !collectible(this.process)) return this.receipt('native');
    const numericComplete = this.process.collection === 'complete' && !this.numbers!.failure && await this.completeNumbers();
    const code = this.collectionCode(numericComplete);
    this.phase = 'summary'; this.fence.check();
    const collection = this.ports.summary({ compiledSuite: this.input.compiled.suite, outputDirectory: this.input.outputDirectory,
      uid: this.input.uid, process: this.process, deadlineMs: this.input.compiled.attempt.deadlineMs,
      timeoutMs: this.input.limits.collectionTimeoutMs, signal: this.fence.controller.signal, wallNow: this.input.clock.wall });
    this.collection = Object.freeze({ result: collection.result, quiesced: collection.quiesced, close: collection.close.bind(collection) });
    this.fence.check(); this.summary = await this.collection.result;
    this.fence.check();
    if (!this.summary.ok) return this.receipt(code ?? 'summary');
    await this.collection.quiesced; this.fence.check();
    return this.receipt(code);
  }
  private collectionCode(numericComplete: boolean): ExecutionCode | undefined {
    if (this.numbers!.failure) return 'metrics';
    if (this.process!.collection !== 'complete') return 'native';
    return numericComplete ? undefined : 'metrics';
  }
  private async completeNumbers(): Promise<boolean> {
    this.phase = 'metrics'; this.fence.check();
    try {
      this.stream = this.numbers!.finishStream();
      this.numbers!.verifyBytes(this.stream.bytes, this.process!.metricBytes);
      this.metrics = await this.numbers!.finish(); this.fence.check(); return true;
    } catch { this.fence.check(); return false; }
  }
  private closeNative(): Promise<void> {
    if (!this.native) return Promise.resolve();
    this.nativeClosing ??= Promise.resolve().then(() => this.native!.close());
    void this.nativeClosing.catch(() => undefined);
    return this.nativeClosing;
  }
  private clean(): Promise<void> {
    this.cleanup ??= Promise.resolve().then(async () => {
      const results = await Promise.allSettled([this.closeNative(), Promise.resolve().then(() => this.numbers?.close()),
        Promise.resolve().then(() => this.collection?.close()), Promise.resolve().then(() => this.collection?.quiesced)]);
      if (results.some(result => result.status === 'rejected')) throw new ExecutionError('cleanup');
    });
    return this.cleanup;
  }
  close(): Promise<void> {
    this.fence.stop('closed'); void this.closeNative();
    return this.quiesced;
  }
}
