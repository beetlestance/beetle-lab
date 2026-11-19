import { cleanupAttempt } from './cleanup.js';
import {
  type MappedResult,
  sealResult,
  resultEvidence,
  performanceReports,
  archiveAccounting,
  writeNumericEvidence,
  targetReportWithSpan,
  artifactBytes,
  presentArtifacts,
  finishMetricEvidence,
} from './result-evidence.js';
import { captureOptions } from './options.js';
import { blank, type Quiet } from './state.js';
import { diagnosticArtifact } from '../diagnostics/index.js';
import { warningArtifact } from '../warnings/index.js';
import type { EngineResult } from '@beetle/contracts';
import { createControlWriter, type ControlWriter } from '../control/index.js';
import { openStagedInput, type CompiledInput, type StagedInput } from '../input/index.js';
import type { ExecutionOperation } from '../execution/index.js';
import { mapK6Result } from '../result/index.js';
import { publishK6Result, type ResultPublication } from '../publication/index.js';
import { Artifacts, outputRoot } from '../artifact-custody/index.js';
import { AttemptTarget } from './target.js';
import { executionLimits } from './reservation.js';
import { MetricArchive } from './archive/index.js';
import type { MetricWindow } from '../../aggregation/index.js';
import { AttemptLive, syncHistory } from './live.js';
import { AttemptFence, Notifications, Phases } from '../lifecycle/index.js';
import { numericAllowance, phaseReservation, reserveOutput, type OutputReservation } from './reservation.js';
import type { AttemptPorts } from './ports.js';
import { AttemptError, type AttemptReason, type StagedK6Options, type StagedK6Receipt } from './types.js';
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
  private readonly target = new AttemptTarget();
  private historyAtCollect = 0;
  private reservation: OutputReservation | undefined;
  private stage: AttemptReason = 'input';
  private measured = false;
  private collecting = false;
  constructor(
    private readonly options: StagedK6Options,
    private readonly ports: AttemptPorts,
  ) {
    this.fence = new AttemptFence(ports.clock, options.signal, options.headerTimeoutMs!);
    this.notifications = new Notifications(options.onEvent, this.fence);
  }
  private fail(reason: AttemptReason): never {
    throw new AttemptError(reason);
  }
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
      await this.cleanup();
      this.fence.dispose();
    }
    this.state.liveMetrics = this.live.state();
    this.state.notifications = this.notifications.status;
    if (this.notifications.status !== 'complete') {
      this.state.ok = false;
      this.state.reason ??= 'notification';
    }
    this.state.quiescence = Object.freeze({ ...this.quiet });
    return Object.freeze({ ...this.state });
  }
  private async open(): Promise<void> {
    this.quiet.input = 'unknown';
    const operation = openStagedInput({
      ...this.options,
      headerTimeoutMs: this.options.headerTimeoutMs!,
      signal: this.fence.controller.signal,
      wallNow: this.ports.clock.wall,
    });
    const result = await operation.result;
    if (result.ok) this.input = result.value;
    await this.settle('input', [operation.quiesced]);
    if (!result.ok) {
      this.state.inputFailure = result;
      this.fail('input');
    }
    const input = result.value;
    this.fence.bind(input);
    this.fence.phase(input.manifest.phases.find((item) => item.phase === 'validate')!.timeoutMs);
    const { organizationId, workspaceId, attemptId, generation } = input.staging;
    this.state.scope = Object.freeze({ organizationId, workspaceId, attemptId, generation });
    this.stage = 'output_limit';
    this.reservation = phaseReservation(
      reserveOutput(input.offer.budget.outputBytes, false, this.options.liveMetricMailbox),
      input.manifest,
    );
    this.stage = 'profile';
    this.artifacts = new Artifacts({ directory: this.options.outputRoot, uid: this.options.uid, fence: this.fence });
    await outputRoot({ directory: this.options.outputRoot, uid: this.options.uid, fence: this.fence });
    this.stage = 'journal';
    this.quiet.journal = 'unknown';
    this.writer = await createControlWriter(
      { directory: this.options.outputRoot, scope: this.state.scope, quotaBytes: this.reservation.control },
      this.fence.budget(),
    );
    this.phases = new Phases(this.writer, this.state.scope, input.manifest, this.fence, this.notifications);
    await this.phases.start('validate');
  }
  private async compile(): Promise<CompiledInput> {
    this.stage = 'compile';
    this.fence.check();
    this.quiet.input = 'unknown';
    const operation = this.input!.compile();
    const result = await operation.result;
    await this.settle('input', [operation.quiesced]);
    if (!result.ok) {
      this.state.inputFailure = result;
      this.fail('compile');
    }
    this.reservation = phaseReservation(
      reserveOutput(
        this.input!.offer.budget.outputBytes,
        !!result.value.suite.targetSampling,
        this.options.liveMetricMailbox,
      ),
      this.input!.manifest,
    );
    await this.phases!.transition('prepare', 1);
    this.fence.check();
    return result.value;
  }
  private async invoke(compiled: CompiledInput): Promise<void> {
    this.stage = 'execution';
    this.fence.check();
    this.quiet.execution = 'unknown';
    await this.target.start({
      suite: compiled.suite,
      directory: this.options.outputRoot,
      uid: this.options.uid,
      scope: this.state.scope!,
      allowance: this.reservation!.targetHistory,
      signal: this.fence.controller.signal,
      wall: this.ports.clock.wall,
      check: () => this.fence.check(),
    });
    this.fence.check();
    const reservation = this.reservation!;
    const collectMs = this.input!.manifest.phases.find((item) => item.phase === 'collect')!.timeoutMs;
    this.execution = this.ports.execute({
      compiled,
      binary: '/usr/local/bin/k6',
      emptyConfig: '/beetle/image/empty.json',
      outputDirectory: this.options.outputRoot,
      uid: this.options.uid,
      signal: this.fence.controller.signal,
      clock: this.ports.clock,
      limits: executionLimits(reservation, collectMs),
      window: (window, signal) => this.writeWindow(window, signal),
      measureStarted: async (receipt) => {
        if (this.measured || this.collecting) this.fail('execution');
        this.measured = true;
        await this.phases!.transition('execute', 1, receipt.observedAt, receipt.build.bytes);
        await this.target.startRecording();
        await this.startLive(compiled);
      },
      collectStarted: async (receipt) => {
        if (this.collecting) this.fail('execution');
        await this.live.closeCheckpoint();
        await this.target.finish();
        this.fence.check();
        await this.closeLive();
        this.collecting = true;
        this.historyAtCollect = this.archive?.bytes ?? 0;
        this.archive?.beginCollection(reservation.historyCollect);
        await this.phases!.transition(
          'collect',
          this.measured ? 1 : 0,
          this.target.source ? undefined : receipt.observedAt,
          this.historyAtCollect +
            this.live.state().producedBytes +
            this.target.bytes +
            (this.measured ? 0 : receipt.build.bytes),
        );
      },
    });
    await this.execution.result;
    // First failure may precede original work. Preserve late actual facts without upgrading it.
    const results = await Promise.allSettled([
      this.execution.final,
      this.execution.quiesced,
      this.execution.close(),
      this.input!.close(),
    ]);
    const final = results[0];
    if (final?.status === 'fulfilled') this.state.execution = final.value;
    this.quiet.execution = results.slice(0, 3).every((item) => item.status === 'fulfilled') ? 'confirmed' : 'failed';
    this.quiet.input = results[3]?.status === 'fulfilled' ? 'confirmed' : 'failed';
    await this.closeLive();
    await this.notifications.quiesce();
    this.quiet.notifications = 'confirmed';
    if (this.quiet.execution !== 'confirmed' || this.quiet.input !== 'confirmed') this.fail('cleanup');
    if (this.archiveFailure) throw this.archiveFailure;
    if (this.target.failure) throw this.target.failure;
    this.fence.check();
  }
  private async startLive(compiled: CompiledInput): Promise<void> {
    if (!this.options.liveMetricMailbox) return;
    await this.live.start(
      {
        assignment: { specDigest: this.input!.staging.specDigest, intentDigest: this.input!.offer.intentDigest },
        suite: compiled.suite,
        scope: this.state.scope!,
        uid: this.options.uid,
        maximumBytes: this.reservation!.live,
        timeoutMs: Math.max(1, Math.floor(this.fence.lifetimeRemaining())),
        signal: this.fence.controller.signal,
        clock: this.ports.clock,
        archivePrefix: () => this.archive?.completedPrefix(),
        checkpoint: {
          root: this.options.outputRoot,
          sync: (target, check) => syncHistory(this.archive!, this.target, target, check),
        },
        ...(this.target.source ? { target: this.target.source } : {}),
      },
      this.ports.openMailbox,
    );
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
      this.archive = await MetricArchive.create({
        directory: this.options.outputRoot,
        uid: this.options.uid,
        allowance: this.collecting ? Math.min(reserved.history, reserved.historyCollect) : reserved.history,
        scope: this.state.scope!,
        fence: this.fence,
      });
      return this.archive;
    } catch (error) {
      this.quiet.artifacts = error instanceof AttemptError && error.reason === 'cleanup' ? 'failed' : 'confirmed';
      throw error;
    }
  }
  private async writeWindow(window: MetricWindow, signal: AbortSignal): Promise<void> {
    this.fence.check();
    try {
      await (await this.ensureArchive()).append(window);
    } catch (error) {
      this.archiveFailure ??= error instanceof AttemptError ? error : new AttemptError('artifact');
      throw this.archiveFailure;
    }
    if (this.measured && !this.collecting) this.live.accept(window);
    await this.options.onWindow?.(window, signal);
    this.fence.check();
  }
  private async collectArtifacts(initial: MappedResult, compiled: CompiledInput) {
    this.stage = 'artifact';
    this.quiet.artifacts = 'unknown';
    const archive = this.state.execution!.metrics ? await this.ensureArchive() : this.archive;
    const { history, evidence, mapped } = await finishMetricEvidence(archive, this.state, compiled, initial);
    const summary = evidence.execution!.summary;
    const collectOutputBytes = this.input!.manifest.phases.find((phase) => phase.phase === 'collect')!.outputBytes;
    const historyWork = archiveAccounting(this.archive, this.historyAtCollect, history);
    const targetReport = targetReportWithSpan(this.target.report, evidence.execution!);
    const target = targetReport ? await this.artifacts!.target(targetReport, this.reservation!.target) : undefined;
    const warning = warningArtifact(compiled, evidence.execution!, this.state.scope!);
    const warnings = warning ? await this.artifacts!.warnings(warning, this.reservation!.warnings) : undefined;
    const diagnosticReport = diagnosticArtifact(evidence.execution!, { ...this.state.scope!, generation: 1 });
    const diagnostics = diagnosticReport
      ? await this.artifacts!.diagnostics(diagnosticReport, this.reservation!.diagnostics)
      : undefined;
    const reports = performanceReports(mapped, evidence, this.reservation!, this.target.report);
    const numericBytes = numericAllowance(
      this.reservation!,
      collectOutputBytes -
        artifactBytes(diagnostics) -
        artifactBytes(warnings) -
        historyWork.produced -
        artifactBytes(target) -
        reports.text.length -
        reports.csv.length,
      summary?.ok ? summary.evidence.rawBytes : 1_048_576,
    );
    const artifacts: EngineResult['artifacts'] = [...historyWork.artifacts];
    artifacts.push(...presentArtifacts(warnings, diagnostics, target));
    if (summary?.ok) artifacts.push(await this.artifacts!.summary(summary.evidence));
    artifacts.push(await writeNumericEvidence(this.artifacts!, evidence, mapped.diagnostics, history, numericBytes));
    const reportAllowance = this.reservation!.reports / 2;
    artifacts.push(await this.artifacts!.report('performance-report', reports.text, reportAllowance));
    artifacts.push(await this.artifacts!.report('metrics-csv', reports.csv, reportAllowance));
    this.quiet.artifacts = this.artifactQuiescence();
    await this.notifications.quiesce();
    this.fence.check();
    if (!this.collecting) this.fail('execution');
    await this.phases!.finish(
      1,
      artifacts.reduce((sum, artifact) => sum + artifact.bytes, 0) - historyWork.published + historyWork.produced,
    );
    return { artifacts, evidence, native: mapped.body.nativeOverview };
  }
  private artifactQuiescence(): 'confirmed' | 'failed' {
    return this.quiet.artifacts === 'failed' ||
      this.artifacts?.quiescence === 'failed' ||
      this.archive?.quiescence === 'failed' ||
      this.target.quiescence === 'failed' ||
      this.live.state().quiescence === 'failed'
      ? 'failed'
      : 'confirmed';
  }
  private async finishResult(compiled: CompiledInput): Promise<void> {
    this.stage = 'mapping';
    this.fence.check();
    const initial = mapK6Result(resultEvidence(this.state, compiled, []));
    if (!initial.ok) this.fail('mapping');
    const { artifacts, evidence, native } = await this.collectArtifacts(initial, compiled);
    this.stage = 'seal';
    await this.phases!.start('seal');
    await this.notifications.quiesce();
    this.fence.check();
    const mapped = mapK6Result(resultEvidence(evidence, compiled, artifacts, native));
    if (!mapped.ok) this.fail('mapping');
    const sealed = sealResult(mapped.body, this.fence.timestamp());
    if (!sealed.ok) this.fail('seal');
    const event = this.phases!.resultDraft(sealed.value);
    this.stage = 'publication';
    this.quiet.publication = 'unknown';
    const sealOutputBytes = this.input!.manifest.phases.find((phase) => phase.phase === 'seal')!.outputBytes;
    this.publication = publishK6Result({
      result: sealed.value,
      expectedScope: this.state.scope!,
      directory: this.options.outputRoot,
      uid: this.options.uid,
      maximumBytes: Math.min(this.reservation!.result, sealOutputBytes),
      deadlineMs: compiled.attempt.deadlineMs,
      timeoutMs: Math.min(60_000, Math.floor(this.fence.remaining())),
      signal: this.fence.controller.signal,
      wallNow: this.ports.clock.wall,
    });
    const published = await this.publication.result;
    this.state.publication = published;
    if (published.ok) this.state.result = published.value;
    await this.settle('publication', [this.publication.quiesced, this.publication.close()]);
    if (!published.ok) this.fail('publication');
    await this.phases!.result(event);
    await this.phases!.finish(1, published.bytes);
  }
  private async settle(key: keyof Quiet, promises: readonly Promise<unknown>[]): Promise<void> {
    const outcomes = await Promise.allSettled(promises);
    this.quiet[key] = outcomes.every((outcome) => outcome.status === 'fulfilled') ? 'confirmed' : 'failed';
    if (this.quiet[key] === 'failed') this.fail('cleanup');
  }
  private cleanup(): Promise<void> {
    return cleanupAttempt(this.state, this.quiet, {
      input: this.input,
      execution: this.execution,
      publication: this.publication,
      archive: this.archive,
      target: this.target,
      notifications: this.notifications,
      writer: this.writer,
      phases: this.phases,
      artifacts: this.artifacts,
      liveMetricMailbox: this.options.liveMetricMailbox,
      closeLive: () => this.closeLive(),
      closeCheckpoint: () => this.live.closeCheckpoint(),
      artifactQuiescence: () => this.artifactQuiescence(),
    });
  }
}
/** Private composition seam, used only by focused tests; never staged/public configuration. */
export async function runAttempt(options: StagedK6Options, ports: AttemptPorts): Promise<StagedK6Receipt> {
  try {
    return await new Attempt(captureOptions(options), ports).run();
  } catch (error) {
    return Object.freeze({ ...blank(), reason: error instanceof AttemptError ? error.reason : 'profile' });
  }
}
