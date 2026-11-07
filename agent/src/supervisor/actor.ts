import { randomUUID } from 'node:crypto';
import type { Reservation, AdmissionValue } from '../admission/index.js';
import type { InspectEvidence, MutationResult, Observation } from '../backends/docker/index.js';
import type { SupervisionState } from '../journal/index.js';
import { validateReservation } from './identity.js';
import { RuntimeEvidence } from './evidence.js';
import { AttemptTime } from './time.js';
import type { BackendPort, Clock, JournalPort, LaunchInput, LaunchState } from './types.js';
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
  private current: Reservation | undefined;
  private durable: SupervisionState | undefined;
  private observation: Observation | null = null;
  private cause: LaunchState['cancellation'] = 'none';
  private inFlight: Promise<LaunchState> | undefined;
  private cancellationWrite: Promise<void> | undefined;
  private cancellation: Promise<LaunchState> | undefined;
  private localCancel = false;
  private closed = false;
  private launchAttempted = false;
  private createKnown = false;
  private startSent = false;
  private startKnown = false;
  private disposition: LaunchState['launch'] = 'unclaimed';

  constructor(readonly input: LaunchInput, private readonly journal: JournalPort,
    private readonly backend: BackendPort, clock: Clock) {
    this.time = new AttemptTime(clock);
    this.evidence = new RuntimeEvidence(journal, input.key);
  }
  launch(): Promise<LaunchState> { return this.run(true); }
  reconcile(): Promise<LaunchState> { return this.run(false); }
  tick(): Promise<LaunchState> { return this.run(false); }
  cancel(): Promise<LaunchState> {
    this.localCancel = true;
    this.cancellation ??= this.persistCancellation().then(async () => {
      await this.inFlight;
      return this.run(false);
    }).finally(() => { this.cancellation = undefined; });
    return this.cancellation;
  }
  /** Synchronous retirement refuses every outstanding lane; old handles are fenced. */
  retire(): void {
    if (this.inFlight || this.cancellationWrite || this.cancellation) throw new SupervisorError('conflict');
    this.closed = true;
  }
  private state(): LaunchState {
    return { observation: this.observation ? { ...this.observation } : null, launch: this.disposition, cancellation: this.cause };
  }
  private run(launch: boolean): Promise<LaunchState> {
    if (this.closed) return Promise.reject(new SupervisorError('closed'));
    if (this.inFlight) return this.inFlight;
    const shouldLaunch = launch && !this.launchAttempted;
    if (shouldLaunch) this.launchAttempted = true;
    const work = this.step(shouldLaunch).catch(error => {
      // Any uncertain journal response permanently retires local launch grants.
      this.launchAttempted = true;
      throw error instanceof SupervisorError ? error : new SupervisorError('journal_unavailable');
    }).finally(() => { this.inFlight = undefined; });
    this.inFlight = work;
    return work;
  }
  private async load(): Promise<void> {
    const value = reservation(await this.journal.admission({ kind: 'reservation', key: this.input.key }));
    const offer = await this.journal.readOffer(this.input.key);
    validateReservation(this.input, value, offer);
    this.current = value;
    this.disposition = value.launchSettlement?.disposition ?? (value.createToken ? 'unknown' : 'unclaimed');
  }
  private async sample(cancel = false): Promise<void> {
    const issued = this.time.capture();
    const state = await this.journal.supervision({ key: this.input.key, now: issued.wall, ...(cancel ? { cancel: true } : {}) });
    this.time.update(state, issued.monotonic, this.current);
    // A delayed pre-cancel read must never erase the concurrent durable cancel.
    if (!this.durable?.cancelRequested || state.cancelRequested) this.durable = state;
    this.localCancel ||= state.cancelRequested;
    if (this.time.fenced()) this.cause = 'clock_integrity';
    else if (state.cancelRequested && this.cause === 'none') this.cause = 'cancelled';
  }
  private persistCancellation(): Promise<void> {
    this.localCancel = true;
    if (this.cancellationWrite) return this.cancellationWrite;
    const write = this.sample(true).catch(() => { throw new SupervisorError('journal_unavailable'); })
      .finally(() => { this.cancellationWrite = undefined; });
    this.cancellationWrite = write;
    return write;
  }
  private async gate(): Promise<boolean> {
    await this.sample();
    if (this.time.expired() && this.cause === 'none') this.cause = 'timeout';
    if (this.cause === 'timeout' || this.cause === 'clock_integrity') await this.persistCancellation();
    return !this.closed && !this.localCancel && !this.time.fenced() && !this.time.expired();
  }
  private async step(launch: boolean): Promise<LaunchState> {
    await this.load();
    const allowed = await this.gate();
    if (launch && allowed) await this.createAndStart();
    else if (this.current!.createToken) await this.recover();
    // Backend latency consumes execution time even when no new action follows.
    await this.gate();
    if (this.localCancel) await this.stopCancelled();
    return this.state();
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
    // No await between the final local fence and consuming the one-shot capability.
    if (this.localCancel || this.closed) return;
    const created = await this.mutate(() => this.backend.ensureCreated(this.input.plan, this.time.operation(true)));
    this.createKnown = created.outcome === 'known';
    if (created.outcome !== 'known') { await this.recover(); return; }
    await this.bind(created.value);
    await this.record(created.value);
    if (!await this.gate()) { await this.settle(); return; }
    if (created.value.state !== 'created') { await this.settle(); return; }
    await this.startCreated();
  }
  private async startCreated(): Promise<void> {
    const start = claim(await this.journal.admission({ kind: 'claimStart', ...this.binding(), now: this.time.wall() }));
    this.current = start.reservation;
    if (!start.dispatchAllowed) { await this.recover(); return; }
    if (this.localCancel || this.closed || this.time.fenced() || this.time.expired()) {
      await this.gate(); await this.settle(); return;
    }
    this.startSent = true;
    const started = await this.mutate(() => this.backend.dispatchStartOnce(this.input.plan, this.time.operation(true)));
    this.startKnown = started.outcome === 'known';
    if (started.outcome === 'known') await this.record(started.value);
    else await this.recover();
    await this.settle();
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
    await this.record(view);
    // Inspection never upgrades uncertainty from a previous process or request.
  }
  private async record(view: Observation): Promise<void> {
    if ('id' in view && this.current!.runtimeId !== view.id) throw new SupervisorError('conflict');
    await this.evidence.observe(view, this.time.wall(), this.cause);
    this.observation = view;
  }
  private async settle(): Promise<void> {
    const value = this.current!;
    if (!value.runtimeId || value.launchSettlement || this.time.fenced()) return;
    const disposition = this.createKnown && this.startSent && this.startKnown ? 'completed'
      : this.createKnown && !this.startSent ? 'retired' : 'unknown';
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
    if (origin !== null && origin <= 8_640_000_000_000_000) await this.evidence.cancelled(origin, this.time.wall());
    if (!this.current!.createToken) return;
    // Launch has resolved before this lane executes; no in-flight start can escape stop.
    await this.sample();
    const emergency = this.time.fenced();
    const kill = emergency || this.time.graceElapsed();
    const result = await this.mutate(() => kill
      ? this.backend.kill(this.input.plan, this.time.operation())
      : this.backend.stop(this.input.plan, this.time.operation(), this.time.graceDeadline()));
    if (result.outcome === 'known') { await this.bind(result.value); await this.record(result.value); }
    else await this.recover();
    await this.settle();
  }
}
