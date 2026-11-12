import { renderPerformanceReports, ReportError } from '../../report/index.js';
import { isAbsolute, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { sealEngineResult } from '@beetle/contracts';
import type { EngineResult } from '@beetle/contracts';
import { createControlWriter } from '../control/index.js';
import type { ControlWriter } from '../control/index.js';
import { openStagedInput } from '../input/index.js';
import type { CompiledInput, StagedInput } from '../input/index.js';
import type { ExecutionOperation } from '../execution/index.js';
import { mapK6Result } from '../result/index.js';
import type { K6ResultInput, K6ResultMapping } from '../result/index.js';
import { publishK6Result } from '../publication/index.js';
import type { ResultPublication } from '../publication/index.js';
import { Artifacts, outputRoot } from '../artifact-custody/index.js';
import { startTargetSampling } from '../target-sampling/index.js';
import type { TargetSamplingOwner, TargetSamplingReport } from '../target-sampling/index.js';
import { MetricArchive } from './archive/index.js';
import type { ArchiveEvidence } from './archive/index.js';
import type { MetricWindow } from '../../aggregation/index.js';
import { AttemptLive } from './live.js';
import { AttemptFence } from '../lifecycle/index.js';
import { Notifications } from '../lifecycle/index.js';
import { Phases } from '../lifecycle/index.js';
import { numericAllowance, phaseReservation, reserveOutput } from './reservation.js';
import type { OutputReservation } from './reservation.js';
import type { AttemptPorts } from './ports.js';
import { AttemptError } from './types.js';
import type { AttemptReason, Quiescence, StagedK6Options, StagedK6Receipt } from './types.js';

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
type State = { -readonly [K in keyof StagedK6Receipt]: StagedK6Receipt[K] };
type Quiet = Record<keyof StagedK6Receipt['quiescence'], Quiescence>;
type MappedResult = Extract<K6ResultMapping, {ok: true}>;
type MappingDiagnostics = Extract<K6ResultMapping, { ok: true }>['diagnostics'];
function path(value: string): boolean { return typeof value === 'string' && isAbsolute(value) && resolve(value) === value && !value.includes('\0'); }
function validateOptions(input: StagedK6Options): void {
  const roots = [input.inputRoot, input.secretRoot, input.outputRoot];
  if (!roots.every(path) || new Set(roots).size !== 3 || !Number.isSafeInteger(input.uid) || input.uid < 0
    || input.uid !== process.getuid?.() || !(input.signal instanceof AbortSignal)) throw new AttemptError('profile');
}
function capture(input: StagedK6Options): StagedK6Options {
  validateOptions(input);
  const headerTimeoutMs = input.headerTimeoutMs ?? 5000;
  if (!Number.isSafeInteger(headerTimeoutMs) || headerTimeoutMs < 1 || headerTimeoutMs > 60_000) throw new AttemptError('profile');
  validateCallbacks(input);
  if (input.liveMetricMailbox !== undefined && typeof input.liveMetricMailbox !== 'boolean') throw new AttemptError('profile');
  return Object.freeze({ inputRoot: input.inputRoot, secretRoot: input.secretRoot, outputRoot: input.outputRoot,
    uid: input.uid, signal: input.signal, headerTimeoutMs, liveMetricMailbox: input.liveMetricMailbox === true, installed: Object.freeze({ ...input.installed }),
    ...(input.expected ? { expected: Object.freeze({ ...input.expected }) } : {}),
    ...(input.onEvent ? { onEvent: input.onEvent } : {}), ...(input.onWindow ? { onWindow: input.onWindow } : {}) });
}
function validateCallbacks(input: StagedK6Options): void {
  for (const callback of [input.onEvent, input.onWindow]) {
    if (callback !== undefined && typeof callback !== 'function') throw new AttemptError('profile');
  }
}
function blank(): State {
  return { ok: false, reason: null, scope: null, inputFailure: null, execution: null, result: null, publication: null,
    notifications: 'complete', liveMetrics: {status: 'disabled', reason: null, producedBytes: 0, quiescence: 'confirmed'}, quiescence: { input: 'not_started', execution: 'not_started',
      artifacts: 'not_started', journal: 'not_started', publication: 'not_started', notifications: 'not_started' } };
}

/** Composition root: no compiler/parser/outcome or publication implementation here. */
class Attempt {
  private readonly state = blank();
  private readonly live = new AttemptLive();
  private readonly quiet: Quiet = { ...this.state.quiescence };
  private readonly fence: AttemptFence;
  private readonly notifications: Notifications;
  private input: StagedInput | undefined;
  private writer: ControlWriter | undefined;
  private phases: Phases | undefined;
  private execution: ExecutionOperation | undefined;
  private publication: ResultPublication | undefined;
  private artifacts: Artifacts | undefined;
  private archive: MetricArchive | undefined;
  private archiveFailure: AttemptError | undefined;
  private targetSampler: TargetSamplingOwner | undefined;
  private targetReport: TargetSamplingReport | undefined;
  private historyAtCollect = 0;
  private reservation: OutputReservation | undefined;
  private stage: AttemptReason = 'input';
  private measured = false;
  private collecting = false;
  constructor(private readonly options: StagedK6Options, private readonly ports: AttemptPorts) {
    this.fence = new AttemptFence(ports.clock, options.signal, options.headerTimeoutMs!);
    this.notifications = new Notifications(options.onEvent, this.fence);
  }
  private fail(reason: AttemptReason): never { throw new AttemptError(reason); }
  async run(): Promise<StagedK6Receipt> {
    try {
      await this.open();
      const compiled = await this.compile();
      await this.invoke(compiled);
      await this.finishResult(compiled);
      this.state.ok = this.state.execution?.ok === true && this.state.publication?.ok === true;
      if (!this.state.ok) this.state.reason = 'execution';
    } catch (error) {
      this.state.reason = this.fence.reason ?? (error instanceof AttemptError ? error.reason : this.stage);
      this.fence.stop(this.state.reason);
    } finally {
      await this.cleanup(); this.fence.dispose();
    }
    this.state.liveMetrics = this.live.state();
    this.state.notifications = this.notifications.status;
    if (this.notifications.status !== 'complete') { this.state.ok = false; this.state.reason ??= 'notification'; }
    this.state.quiescence = Object.freeze({ ...this.quiet });
    return Object.freeze({ ...this.state });
  }
  private async open(): Promise<void> {
    this.quiet.input = 'unknown';
    const operation = openStagedInput({ ...this.options, headerTimeoutMs: this.options.headerTimeoutMs!,
      signal: this.fence.controller.signal, wallNow: this.ports.clock.wall });
    const result = await operation.result;
    if (result.ok) this.input = result.value;
    await this.settle('input', [operation.quiesced]);
    if (!result.ok) { this.state.inputFailure = result; this.fail('input'); }
    const input = result.value;
    this.fence.bind(input);
    this.fence.phase(input.manifest.phases.find(item => item.phase === 'validate')!.timeoutMs);
    const { organizationId, workspaceId, attemptId, generation } = input.staging;
    this.state.scope = Object.freeze({ organizationId, workspaceId, attemptId, generation });
    this.stage = 'output_limit'; this.reservation = phaseReservation(reserveOutput(input.offer.budget.outputBytes, false, this.options.liveMetricMailbox), input.manifest);
    this.stage = 'profile';
    this.artifacts = new Artifacts({ directory: this.options.outputRoot, uid: this.options.uid, fence: this.fence });
    await outputRoot({ directory: this.options.outputRoot, uid: this.options.uid, fence: this.fence });
    this.stage = 'journal'; this.quiet.journal = 'unknown';
    this.writer = await createControlWriter({ directory: this.options.outputRoot, scope: this.state.scope,
      quotaBytes: this.reservation.control }, this.fence.budget());
    this.phases = new Phases(this.writer, this.state.scope, input.manifest, this.fence, this.notifications);
    await this.phases.start('validate');
  }
  private async compile(): Promise<CompiledInput> {
    this.stage = 'compile'; this.fence.check();
    this.quiet.input = 'unknown'; const operation = this.input!.compile();
    const result = await operation.result;
    await this.settle('input', [operation.quiesced]);
    if (!result.ok) { this.state.inputFailure = result; this.fail('compile'); }
    this.reservation = phaseReservation(reserveOutput(this.input!.offer.budget.outputBytes, !!result.value.suite.targetSampling, this.options.liveMetricMailbox), this.input!.manifest);
    await this.phases!.transition('prepare', 1); this.fence.check(); return result.value;
  }
  private async invoke(compiled: CompiledInput): Promise<void> {
    this.stage = 'execution'; this.fence.check(); this.quiet.execution = 'unknown';
    const sampling = compiled.suite.targetSampling;
    if (sampling) this.targetSampler = await startTargetSampling({ target: compiled.suite.target, config: sampling, signal: this.fence.controller.signal });
    this.fence.check();
    const reservation = this.reservation!;
    const collectMs = this.input!.manifest.phases.find(item => item.phase === 'collect')!.timeoutMs;
    this.execution = this.ports.execute({ compiled, binary: '/usr/local/bin/k6', emptyConfig: '/beetle/image/empty.json',
      outputDirectory: this.options.outputRoot, uid: this.options.uid, signal: this.fence.controller.signal,
      clock: this.ports.clock, limits: { maximumBuildBytes: reservation.build, reservedOutputBytes: reservation.execution,
        maximumMetricBytes: 68_719_476_736, maximumMetricRecords: 268_435_456,
        maximumDiagnosticBytes: 65_536, drainTimeoutMs: 1000, collectionTimeoutMs: Math.min(30_000, collectMs) },
      window: (window, signal) => this.writeWindow(window, signal),
      measureStarted: async receipt => {
        if (this.measured || this.collecting) this.fail('execution');
        this.measured = true; await this.phases!.transition('execute', 1, receipt.observedAt, receipt.build.bytes);
        await this.startLive(compiled);
      }, collectStarted: async receipt => {
        if (this.collecting) this.fail('execution');
        if (this.targetSampler) this.targetReport = await this.targetSampler.finish();
        this.fence.check();
        await this.closeLive();
        this.collecting = true;
        this.historyAtCollect = this.archive?.bytes ?? 0;
        this.archive?.beginCollection(reservation.historyCollect);
        await this.phases!.transition('collect', this.measured ? 1 : 0, this.targetSampler ? undefined : receipt.observedAt,
          this.historyAtCollect + this.live.state().producedBytes + (this.measured ? 0 : receipt.build.bytes));
      } });
    await this.execution.result;
    // First failure may precede original work. Preserve late actual facts without upgrading it.
    const results = await Promise.allSettled([this.execution.final, this.execution.quiesced, this.execution.close(), this.input!.close()]);
    const final = results[0]; if (final?.status === 'fulfilled') this.state.execution = final.value;
    this.quiet.execution = results.slice(0, 3).every(item => item.status === 'fulfilled') ? 'confirmed' : 'failed';
    this.quiet.input = results[3]?.status === 'fulfilled' ? 'confirmed' : 'failed';
    await this.closeLive();
    await this.notifications.quiesce(); this.quiet.notifications = 'confirmed';
    if (this.quiet.execution !== 'confirmed' || this.quiet.input !== 'confirmed') this.fail('cleanup');
    if (this.archiveFailure) throw this.archiveFailure;
    this.fence.check();
  }
  private async startLive(compiled: CompiledInput): Promise<void> {
    if (!this.options.liveMetricMailbox) return;
    await this.live.start({assignment: {specDigest: this.input!.staging.specDigest, intentDigest: this.input!.offer.intentDigest},
      suite: compiled.suite, scope: this.state.scope!, uid: this.options.uid,
      maximumBytes: this.reservation!.live, timeoutMs: Math.max(1, Math.floor(this.fence.lifetimeRemaining())),
      signal: this.fence.controller.signal, clock: this.ports.clock}, this.ports.openMailbox);
    if (this.live.state().quiescence === 'failed') this.fail('cleanup');
  }
  private async closeLive(): Promise<void> {
    if ((await this.live.close()).quiescence !== 'confirmed') this.fail('cleanup');
  }
  private async ensureArchive(): Promise<MetricArchive> {
    if (this.archive) return this.archive;
    this.quiet.artifacts = 'unknown';
    const reserved = this.reservation!;
    try {
      this.archive = await MetricArchive.create({ directory: this.options.outputRoot, uid: this.options.uid,
        allowance: this.collecting ? Math.min(reserved.history, reserved.historyCollect) : reserved.history,
        scope: this.state.scope!, fence: this.fence });
      return this.archive;
    } catch (error) {
      this.quiet.artifacts = error instanceof AttemptError && error.reason === 'cleanup' ? 'failed' : 'confirmed';
      throw error;
    }
  }
  private async writeWindow(window: MetricWindow, signal: AbortSignal): Promise<void> {
    this.fence.check();
    try { await (await this.ensureArchive()).append(window); }
    catch (error) {
      this.archiveFailure ??= error instanceof AttemptError ? error : new AttemptError('artifact'); throw this.archiveFailure;
    }
    if (this.measured && !this.collecting) this.live.accept(window);
    await this.options.onWindow?.(window, signal); this.fence.check();
  }
  private async archiveEvidence(): Promise<ArchiveEvidence | null> {
    if (this.state.execution!.metrics) return (await this.ensureArchive()).finish();
    await this.archive?.close(); return null;
  }
  private evidence(compiled: CompiledInput, artifacts: EngineResult['artifacts']): K6ResultInput {
    const receipt = this.state.execution!;
    if (!receipt.process || !receipt.terminalObservedAt) this.fail('execution');
    // Native cause already carries cancellation/output-limit identity. Do not mask it as engine_crash.
    const failure = receipt.ok ? null : receipt.code === 'native' && receipt.process.cause !== null ? null : receipt.code;
    return { suite: compiled.suite, scope: this.state.scope!, process: receipt.process,
      terminalObservedAt: receipt.terminalObservedAt, orchestrationFailure: failure, orchestrationQuiescent: true,
      summary: receipt.summary?.ok ? receipt.summary.evidence : null, metrics: receipt.metrics, artifacts };
  }
  private async collectArtifacts(mapped: MappedResult): Promise<EngineResult['artifacts']> {
    this.stage = 'artifact'; this.quiet.artifacts = 'unknown';
    const summary = this.state.execution!.summary;
    const collectOutputBytes = this.input!.manifest.phases.find(phase => phase.phase === 'collect')!.outputBytes;
    const history = await this.archiveEvidence();
    const historyWork = this.archiveAccounting(history);
    const target = this.targetReport ? await this.artifacts!.target(this.targetReport, this.reservation!.target) : undefined;
    const reports = this.reports(mapped);
    const numericBytes = numericAllowance(this.reservation!, collectOutputBytes - historyWork.produced - (target?.bytes ?? 0) - reports.text.length - reports.csv.length, summary?.ok ? summary.evidence.rawBytes : 1_048_576);
    const artifacts: EngineResult['artifacts'] = [...historyWork.artifacts];
    if (target) artifacts.push(target);
    if (summary?.ok) artifacts.push(await this.artifacts!.summary(summary.evidence));
    artifacts.push(await this.artifacts!.numeric(this.numericEvidence(mapped.diagnostics, history), numericBytes));
    const reportAllowance = this.reservation!.reports / 2;
    artifacts.push(await this.artifacts!.report('performance-report', reports.text, reportAllowance));
    artifacts.push(await this.artifacts!.report('metrics-csv', reports.csv, reportAllowance));
    this.quiet.artifacts = this.artifactQuiescence();
    await this.notifications.quiesce(); this.fence.check();
    if (!this.collecting) this.fail('execution');
    await this.phases!.finish(1, artifacts.reduce((sum, artifact) => sum + artifact.bytes, 0) - historyWork.published + historyWork.produced);
    return artifacts;
  }
  private reports(mapped: MappedResult) {
    try {return renderPerformanceReports({result: mapped.body, metrics: this.state.execution!.metrics,
      maximumBytes: this.reservation!.reports / 2});}
    catch (error) {throw new AttemptError(error instanceof ReportError && error.code === 'output_limit' ? 'output_limit' : 'artifact');}
  }
  private archiveAccounting(history: ArchiveEvidence | null) {
    return { produced: (this.archive?.bytes ?? 0) - this.historyAtCollect,
      published: history?.bytes ?? 0, artifacts: history?.artifacts ?? [] };
  }
  private numericEvidence(diagnostics: MappingDiagnostics, history: ArchiveEvidence | null) {
    const summary = this.state.execution!.summary;
    const timing = summary?.ok && summary.evidence.nativeCollection === 'complete'
      ? summary.evidence.timing : { testRunDurationMs: null };
    return { version: 4, timing, scope: this.state.scope, metrics: this.state.execution!.metrics,
      diagnostics, buildUsage: this.buildUsage(), windowsRetained: history !== null,
      history: history ? { windows: history.windows, bytes: history.bytes, dataArtifactId: history.dataArtifactId, indexArtifactId: history.indexArtifactId } : null,
      quantiles: this.state.execution!.metrics?.quantiles ?? 'unknown' };
  }
  private artifactQuiescence(): 'confirmed' | 'failed' {
    return this.quiet.artifacts === 'failed' || this.artifacts?.quiescence === 'failed'
      || this.archive?.quiescence === 'failed' || this.live.state().quiescence === 'failed' ? 'failed' : 'confirmed';
  }
  private async finishResult(compiled: CompiledInput): Promise<void> {
    this.stage = 'mapping'; this.fence.check();
    const initial = mapK6Result(this.evidence(compiled, [])); if (!initial.ok) this.fail('mapping');
    const artifacts = await this.collectArtifacts(initial);
    this.stage = 'seal'; await this.phases!.start('seal');
    await this.notifications.quiesce(); this.fence.check();
    const mapped = mapK6Result(this.evidence(compiled, artifacts)); if (!mapped.ok) this.fail('mapping');
    const sealed = sealEngineResult(mapped.body, this.fence.timestamp(), sha256); if (!sealed.ok) this.fail('seal');
    const event = this.phases!.resultDraft(sealed.value);
    this.stage = 'publication'; this.quiet.publication = 'unknown';
    const sealOutputBytes = this.input!.manifest.phases.find(phase => phase.phase === 'seal')!.outputBytes;
    this.publication = publishK6Result({ result: sealed.value, expectedScope: this.state.scope!, directory: this.options.outputRoot,
      uid: this.options.uid, maximumBytes: Math.min(this.reservation!.result, sealOutputBytes), deadlineMs: compiled.attempt.deadlineMs,
      timeoutMs: Math.min(60_000, Math.floor(this.fence.remaining())), signal: this.fence.controller.signal, wallNow: this.ports.clock.wall });
    const published = await this.publication.result;
    this.state.publication = published;
    // Preserve a confirmed publication even if later notification/journal/close work fails.
    if (published.ok) this.state.result = published.value;
    await this.settle('publication', [this.publication.quiesced, this.publication.close()]);
    if (!published.ok) this.fail('publication');
    await this.phases!.result(event); await this.phases!.finish(1, published.bytes);
  }
  private buildUsage(): { bytes: number; peakBytes: number } | null {
    const build = this.state.execution?.build;
    return build ? { bytes: build.bytes, peakBytes: build.peakBytes } : null;
  }
  private async settle(key: keyof Quiet, promises: readonly Promise<unknown>[]): Promise<void> {
    const outcomes = await Promise.allSettled(promises);
    this.quiet[key] = outcomes.every(outcome => outcome.status === 'fulfilled') ? 'confirmed' : 'failed';
    if (this.quiet[key] === 'failed') this.fail('cleanup');
  }
  private async cleanup(): Promise<void> {
    const tasks: { key: keyof Quiet; work: () => Promise<unknown> }[] = [
      ...(this.input ? [{ key: 'input' as const, work: () => this.input!.close() }] : []),
      ...(this.execution ? [{ key: 'execution' as const, work: () => this.execution!.close() }] : []),
      ...(this.publication ? [{ key: 'publication' as const, work: () => this.publication!.close() }] : []),
      ...(this.archive ? [{ key: 'artifacts' as const, work: () => this.archive!.close() }] : []),
      ...(this.targetSampler ? [{ key: 'artifacts' as const, work: () => this.targetSampler!.close() }] : []),
      ...(this.options.liveMetricMailbox ? [{key: 'artifacts' as const, work: () => this.closeLive()}] : []),
      { key: 'notifications', work: () => this.notifications.quiesce() },
      ...(this.writer ? [{ key: 'journal' as const, work: async () => {
        try { await this.phases?.stop(); } finally { await this.writer!.close(); }
      } }] : []),
    ];
    const results = await Promise.allSettled(tasks.map(async task => { await task.work(); return task.key; }));
    results.forEach((result, index) => {
      const key = tasks[index]!.key;
      if (result.status === 'rejected') {
        this.quiet[key] = 'failed'; this.state.ok = false; this.state.reason ??= 'cleanup';
      } else if (this.quiet[key] !== 'failed') this.quiet[key] = 'confirmed';
    });
    if (this.artifacts && this.quiet.artifacts !== 'not_started') {
      this.quiet.artifacts = this.artifactQuiescence();
    }
  }
}

/** Private composition seam, used only by focused tests; never staged/public configuration. */
export async function runAttempt(options: StagedK6Options, ports: AttemptPorts): Promise<StagedK6Receipt> {
  try { return await new Attempt(capture(options), ports).run(); }
  catch (error) { return Object.freeze({ ...blank(), reason: error instanceof AttemptError ? error.reason : 'profile' }); }
}
