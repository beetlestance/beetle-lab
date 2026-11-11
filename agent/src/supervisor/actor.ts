import { AttemptResources } from '../telemetry/index.js';
import type { SamplingAdmission } from '../telemetry/index.js';
import { randomUUID } from 'node:crypto';
import type { Reservation, AdmissionValue } from '../admission/index.js';
import type { InspectEvidence, MutationResult, Observation, Operation } from '../backends/docker/index.js';
import { inspectReleased } from './retirement.js';
import type { StopReason, SupervisionState } from '../journal/index.js';
import { captureAuthority, ReadOfferBusy } from './offer-authority.js';
import { validateReservation } from './identity.js';
import { RuntimeEvidence } from './evidence.js';
import { AttemptTime } from './time.js';
import type { BackendPort, Clock, JournalPort, LaunchInput, LaunchState, OfferAuthority } from './types.js';
import { SupervisorError } from './types.js';

function reservation(value: AdmissionValue): Reservation {
  if (!('status' in value)) throw new SupervisorError('conflict');
  return value;
}
function claim(value: AdmissionValue) {
  if (!('dispatchAllowed' in value)) throw new SupervisorError('conflict');
  return value;
}

/** Owns all create/start capabilities for one scoped immutable generation. */
export class LaunchActor {
  private readonly time: AttemptTime;
  private readonly evidence: RuntimeEvidence;
  private readonly resources: AttemptResources | undefined;
  private finalResources = false;
  private authority: OfferAuthority | undefined;
  private current: Reservation | undefined;
  private durable: SupervisionState | undefined;
  private observation: Observation | null = null;
  private cause: LaunchState['cancellation'] = 'none';
  private inFlight: Promise<LaunchState> | undefined;
  private cancellationWrite: Promise<void> | undefined;
  private cancellation: Promise<LaunchState> | undefined;
  private urgentReason: StopReason | undefined;
  private localCancel = false;
  private closed = false;
  private launchAttempted = false;
  private createKnown = false;
  private startSent = false;
  private startKnown = false;
  private disposition: LaunchState['launch'] = 'unclaimed';
  private retirement: Promise<void> | undefined;
  private retirementFailed = false;
  private retirementReady = false;
  private retiring = false;

  constructor(readonly input: LaunchInput, private readonly journal: JournalPort,
    private readonly backend: BackendPort, clock: Clock, admission: SamplingAdmission) {
    this.time = new AttemptTime(clock);
    this.evidence = new RuntimeEvidence(journal, input.key);
    if (backend.sampleResources) this.resources = new AttemptResources({ clock, admission,
      read: operation => backend.sampleResources!(input.plan, operation) });
  }
  launch(): Promise<LaunchState> { return this.publicRun(true); }
  reconcile(): Promise<LaunchState> { return this.publicRun(false); }
  tick(): Promise<LaunchState> { return this.publicRun(false); }
  private publicRun(launch: boolean): Promise<LaunchState> {
    return this.fenced() ? Promise.reject(new SupervisorError('closed')) : this.run(launch);
  }
  private fenced(): boolean { return this.closed || this.retiring; }
  cancel(reason: StopReason = 'cancelled'): Promise<LaunchState> {
    if (this.fenced()) return Promise.reject(new SupervisorError('closed'));
    this.localCancel = true;
    const urgent = reason === 'output_limit' || reason === 'artifact_incomplete' || reason === 'clock_integrity';
    const escalation = urgent && this.urgentReason === undefined;
    if (urgent) this.urgentReason ??= reason;
    if (this.cancellation && !escalation) return this.cancellation;
    const previous = this.cancellation;
    const write = this.persistCancellation(reason);
    const work = Promise.resolve().then(async () => {
      const outcomes = await Promise.allSettled([previous, write]);
      if (outcomes.some(value => value.status === 'rejected')) throw new SupervisorError('journal_unavailable');
      await this.inFlight?.catch(() => undefined);
      if (this.urgentReason && !this.durable?.immediateStop) await this.persistCancellation(this.urgentReason);
      await this.cancellationWrite;
      return this.run(false);
    }).finally(() => { if (this.cancellation === work) this.cancellation = undefined; });
    this.cancellation = work; return work;
  }
  /** Synchronous retirement refuses every outstanding lane; old handles are fenced. */
  retire(): void {
    if (this.retiring && !this.retirementReady) throw new SupervisorError('conflict');
    if (this.inFlight || this.cancellationWrite || this.cancellation || this.resources?.pending || this.evidence.hasPending) throw new SupervisorError('conflict');
    this.closed = true;
    void this.resources?.close();
  }
  /** Fence public actor handles, drain originals, then inspect without producing new facts. */
  retireReleased(operation: Operation): Promise<void> {
    this.retiring = true;
    if (this.retirement) return this.retirement;
    this.retirement = Promise.resolve().then(async () => {
      const outcomes = await Promise.allSettled([this.inFlight, this.cancellationWrite, this.cancellation]);
      if (outcomes.some(value => value.status === 'rejected') || this.evidence.hasPending) this.retirementFailed = true;
      if (this.retirementFailed) throw new SupervisorError('conflict');
      await this.closeTelemetry();
      await inspectReleased({ journal: this.journal, backend: this.backend, launch: this.input, operation });
      this.retirementReady = true;
    });
    const original = this.retirement;
    void original.catch(() => { if (!this.retirementFailed && this.retirement === original) this.retirement = undefined; });
    return original;
  }
  private state(): LaunchState {
    return { observation: this.observation ? { ...this.observation } : null, launch: this.disposition, cancellation: this.cause };
  }
  private run(launch: boolean): Promise<LaunchState> {
    if (this.closed) return Promise.reject(new SupervisorError('closed'));
    if (this.inFlight) return this.inFlight;
    const priorAttempted = this.launchAttempted;
    const shouldLaunch = launch && !this.launchAttempted;
    if (shouldLaunch) this.launchAttempted = true;
    const work = this.step(shouldLaunch).catch(error => {
      if (error instanceof ReadOfferBusy) {
        this.launchAttempted = priorAttempted;
        throw new SupervisorError('journal_busy');
      }
      // Any uncertain journal response permanently retires local launch grants.
      this.launchAttempted = true;
      throw error instanceof SupervisorError && error.code !== 'journal_busy' ? error : new SupervisorError('journal_unavailable');
    }).finally(() => { this.inFlight = undefined; });
    this.inFlight = work;
    return work;
  }
  private async load(): Promise<void> {
    const value = reservation(await this.journal.admission({ kind: 'reservation', key: this.input.key }));
    this.authority ??= await captureAuthority(this.journal, this.input, value);
    validateReservation(this.input, value, this.authority);
    this.current = value;
    this.disposition = value.launchSettlement?.disposition ?? (value.createToken ? 'unknown' : 'unclaimed');
  }
  private async sample(reason?: StopReason): Promise<void> {
    const issued = this.time.capture();
    const state = await this.journal.supervision({ key: this.input.key, now: issued.wall,
      ...(reason ? { cancel: true, reason } : {}) });
    this.time.update(state, issued.monotonic, this.current);
    // A delayed pre-cancel read must never erase the concurrent durable cancel.
    if (!this.durable?.cancelRequested || state.cancelRequested) this.durable = state;
    this.localCancel ||= state.cancelRequested;
    if (this.time.fenced()) this.cause = 'clock_integrity';
    else if (this.durable?.cancelRequested) this.cause = this.durable.cancelReason ?? 'clock_integrity';
  }
  private persistCancellation(reason: StopReason = this.cause === 'none' ? 'cancelled' : this.cause): Promise<void> {
    this.localCancel = true;
    if (reason === 'output_limit' || reason === 'artifact_incomplete' || reason === 'clock_integrity') this.urgentReason ??= reason;
    if (this.cancellationWrite) return this.cancellationWrite;
    const write = Promise.resolve().then(async () => {
      await this.sample(reason);
      if (this.urgentReason && !this.durable?.immediateStop) await this.sample(this.urgentReason);
    }).catch(() => { throw new SupervisorError('journal_unavailable'); })
      .finally(() => { this.cancellationWrite = undefined; });
    this.cancellationWrite = write;
    return write;
  }
  private async gate(): Promise<boolean> {
    await this.sample();
    const permission = this.time.dispatch();
    if (!permission.allowed && (this.cause === 'none' || permission.reason === 'clock_integrity')) this.cause = permission.reason;
    if (this.cause === 'timeout' || this.cause === 'clock_integrity') await this.persistCancellation();
    return !this.closed && !this.localCancel && permission.allowed;
  }
  private async step(launch: boolean): Promise<LaunchState> {
    await this.load();
    const allowed = await this.gate();
    if (!this.localCancel) {
      if (launch && allowed) await this.createAndStart();
      else if (this.current!.createToken) await this.recover();
    }
    // Backend latency consumes execution time even when no new action follows.
    await this.gate();
    if (this.localCancel) await this.stopCancelled();
    await this.deliver();
    await this.settle();
    return this.state();
  }
  /** Also used by installed shutdown after controller originals have drained. */
  async closeTelemetry(): Promise<void> {
    await this.resources?.close();
    await this.evidence.flush();
    if (this.evidence.hasPending) throw new SupervisorError('journal_unavailable');
  }
  private async captureResources(): Promise<void> {
    const terminal = this.observation?.state === 'exited' || this.observation?.state === 'missing';
    if (terminal && this.resources && !this.finalResources) {
      await this.resources.close();
      this.finalResources = true;
      const summary = this.resources.final();
      if (summary) this.evidence.summarize(summary, this.time.wall());
    } else this.publishResources();
  }
  private publishResources(): void {
    const summary = this.resources?.due();
    if (!summary) return;
    if (this.evidence.resourceWaiting) {
      this.resources!.coalesced(); summary.missedSamples = Math.min(Number.MAX_SAFE_INTEGER, summary.missedSamples + 1);
    }
    this.evidence.summarize(summary, this.time.wall());
  }
  private async deliver(): Promise<void> {
    await this.captureResources();
    const terminal = this.observation?.state === 'exited' || this.observation?.state === 'missing';
    const lifecycle = this.evidence.lifecyclePending;
    const delivery = this.evidence.flush(!terminal && lifecycle);
    if (!terminal && !lifecycle) {
      // Evidence owns the exact original. Periodic telemetry cannot hold the stop lane.
      void delivery.catch(() => undefined); return;
    }
    try {
      await delivery;
      if (!terminal && this.evidence.hasPending) void this.evidence.flush().catch(() => undefined);
    } catch {
      // Fence immediately; the next bounded cancel/tick step signals before retrying
      // delivery. A failed append can never authorize more execution or settlement.
      await this.persistCancellation();
      throw new SupervisorError('journal_unavailable');
    }
  }
  private binding() {
    const value = this.current!;
    if (!value.createToken || !value.runtimeId) throw new SupervisorError('conflict');
    return { key: this.input.key, createToken: value.createToken, specDigest: this.input.plan.specDigest, runtimeId: value.runtimeId };
  }
  private async createAndStart(): Promise<void> {
    const granted = claim(await this.journal.admission({ kind: 'claimCreate', key: this.input.key, specDigest: this.input.plan.specDigest }));
    this.current = granted.reservation; this.disposition = this.current.launchSettlement?.disposition ?? 'unknown';
    if (!granted.dispatchAllowed) { await this.recover(); return; }
    if (!await this.gate()) return;
    const operation = this.dispatchOperation();
    if (!operation) { await this.gate(); return; }
    const created = await this.mutate(() => this.backend.ensureCreated(this.input.plan, operation));
    this.createKnown = created.outcome === 'known';
    if (created.outcome !== 'known') { await this.recover(); return; }
    await this.bind(created.value);
    this.record(created.value);
    if (!await this.gate()) return;
    if (created.value.state !== 'created') return;
    await this.startCreated();
  }
  private async startCreated(): Promise<void> {
    const start = claim(await this.journal.admission({ kind: 'claimStart', ...this.binding(), now: this.time.wall() }));
    this.current = start.reservation;
    if (!start.dispatchAllowed) { await this.recover(); return; }
    const operation = this.dispatchOperation();
    if (!operation) {
      await this.gate(); return;
    }
    this.startSent = true;
    const started = await this.mutate(() => this.backend.dispatchStartOnce(this.input.plan, operation));
    if (started.outcome === 'known') {
      this.record(started.value);
      this.startKnown = started.value.state === 'running' || started.value.state === 'exited';
    } else await this.recover();
  }
  private dispatchOperation() {
    if (this.closed || this.retiring || this.localCancel) return undefined;
    const permission = this.time.dispatch();
    if (!permission.allowed) { this.cause = permission.reason; return undefined; }
    if (this.closed || this.retiring || this.localCancel) return undefined;
    return permission.operation;
  }
  private async mutate(action: () => Promise<MutationResult<InspectEvidence>>): Promise<MutationResult<InspectEvidence>> {
    try { return await action(); }
    catch { throw new SupervisorError('backend_unavailable'); }
  }
  private async bind(observation: InspectEvidence): Promise<void> {
    const value = this.current!;
    if (value.runtimeId && value.runtimeId !== observation.id) throw new SupervisorError('conflict');
    if (!value.createToken) throw new SupervisorError('conflict');
    this.current = reservation(await this.journal.admission({ kind: 'bindRuntime', key: this.input.key,
      createToken: value.createToken, specDigest: this.input.plan.specDigest, runtimeId: observation.id }));
  }
  private async recover(): Promise<void> {
    let view: Observation;
    try { view = await this.backend.inspect(this.input.plan, this.time.operation()); }
    catch { throw new SupervisorError('backend_unavailable'); }
    if ('id' in view) await this.bind(view);
    this.record(view, true);
    // Inspection never upgrades uncertainty from a previous process or request.
  }
  private record(view: Observation, recovered = false): void {
    if ('id' in view && this.current!.runtimeId !== view.id) throw new SupervisorError('conflict');
    this.evidence.observe(view, this.time.wall(), this.durable?.cancelReason ?? this.cause);
    this.observation = { ...view };
    if (view.state === 'running') { this.resources?.running(recovered); this.resources?.tick(); }
  }
  private async settle(): Promise<void> {
    const value = this.current!;
    if (!this.createKnown || !value.runtimeId || value.launchSettlement || this.time.fenced() || this.evidence.hasPending) return;
    const disposition = !this.startSent ? 'retired' : this.startKnown ? 'completed' : 'unknown';
    this.current = reservation(await this.journal.admission({ kind: 'settleLaunch', settlement: {
      authority: 'supervisor', ...this.binding(), epoch: value.launchEpoch, startToken: value.startToken,
      disposition, settledAt: this.time.wall(), evidenceId: randomUUID(),
    } }));
    this.disposition = disposition;
  }
  private async stopCancelled(): Promise<void> {
    await this.persistCancellation();
    if (!this.durable?.cancelRequested) throw new SupervisorError('journal_unavailable');
    const origin = this.durable.cancelRequestedAt;
    if (origin !== null && origin <= 8_640_000_000_000_000) this.evidence.cancelled(origin, this.time.wall());
    if (!this.current!.createToken) return;
    // Launch has resolved before this lane executes; no in-flight start can escape stop.
    await this.sample();
    const emergency = this.time.fenced();
    const kill = emergency || this.durable.immediateStop || this.time.graceElapsed();
    const result = await this.mutate(() => kill
      ? this.backend.kill(this.input.plan, this.time.operation())
      : this.backend.stop(this.input.plan, this.time.operation(), this.time.graceDeadline()));
    if (result.outcome === 'known') { await this.bind(result.value); this.record(result.value); }
    else await this.recover();
  }
}
