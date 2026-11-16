import { AttemptLiveMetrics } from './live.js';
import type { Scope } from '../admission/index.js';
import type { LiveMetricRead } from '../live-metrics/index.js';
import { AttemptResources, SamplingAdmission } from '../telemetry/index.js';
import { performance } from 'node:perf_hooks';
import { LaunchActor } from './actor.js';
import { identity, sameScope, validateInput } from './identity.js';
import { SupervisorError } from './types.js';
import type { BackendPort, Clock, LaunchInput, SupervisorOptions } from './types.js';
import type { Operation } from '../backends/docker/index.js';
export { SupervisorError };
export type { LaunchActor } from './actor.js';
export type { BackendPort, Clock, JournalPort, LaunchInput, LaunchState, SupervisorOptions, LiveMetricApprovalFactory } from './types.js';

/** Composition owns one manager per exclusively locked journal/installation. */
export class Supervisor {
  private readonly actors = new Map<string, LaunchActor>();
  private readonly sampling = new SamplingAdmission();
  private telemetryClosed = false;
  private telemetryClosing: Promise<void> | undefined;
  constructor(private readonly options: SupervisorOptions) {
    if (options.requireResourceTelemetry) this.backend();
  }
  closeTelemetry(): Promise<void> {
    if (this.telemetryClosing) return this.telemetryClosing;
    this.telemetryClosed = true;
    let resolve!: () => void; let reject!: (error: unknown) => void;
    this.telemetryClosing = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    void Promise.allSettled(Array.from(this.actors.values(), actor => actor.closeTelemetry())).then(results => {
      if (results.some(result => result.status === 'rejected')) reject(new SupervisorError('journal_unavailable'));
      else resolve();
    });
    return this.telemetryClosing;
  }
  get size(): number { return this.actors.size; }
  actor(input: LaunchInput): LaunchActor {
    if (this.telemetryClosed) throw new SupervisorError('closed');
    try { validateInput(input, this.options.installationId); }
    catch (error) { throw error instanceof SupervisorError ? error : new SupervisorError('invalid_input'); }
    const key = identity(input.key);
    const existing = this.actors.get(key);
    if (existing) {
      if (!sameScope(existing.input.key, input.key) || existing.input.plan.specDigest !== input.plan.specDigest) {
        throw new SupervisorError('conflict');
      }
      return existing;
    }
    if (this.actors.size >= 64) throw new SupervisorError('capacity');
    const snapshot = Object.freeze({ key: Object.freeze({ ...input.key }), plan: input.plan });
    const backend = this.backend();
    const clock = this.options.clock ?? { wall: Date.now, monotonic: () => performance.now() };
    const actor = new LaunchActor(snapshot, this.options.journal, backend, clock, this.telemetry(snapshot, backend, clock));
    this.actors.set(key, actor);
    return actor;
  }
  private telemetry(input: LaunchInput, backend: BackendPort, clock: Clock) {
    const resources = backend.sampleResources ? new AttemptResources({clock, admission: this.sampling,
      read: operation => backend.sampleResources!(input.plan, operation)}) : undefined;
    const live = new AttemptLiveMetrics({input, backend, clock, admission: this.sampling,
      ...(this.options.liveMetricApproval ? {approve: this.options.liveMetricApproval} : {})});
    return {...(resources ? {resources} : {}), live};
  }
  /** Read existing ownership only: never creates an actor or dispatches work. */
  readLiveMetrics(key: Scope, operation: Operation): Promise<LiveMetricRead> {
    if (this.telemetryClosed) return Promise.resolve({ok: false, reason: 'closed'});
    const actor = this.actors.get(identity(key));
    if (!actor || !sameScope(actor.input.key, key)) return Promise.resolve({ok: false, reason: 'unavailable'});
    return actor.readLiveMetrics(operation);
  }
  private backend() {
    try {
      const backend = this.options.backendFactory();
      if (this.options.requireResourceTelemetry && typeof backend.sampleResources !== 'function') throw new Error('telemetry');
      return backend;
    }
    catch { throw new SupervisorError('backend_unavailable'); }
  }
  retire(input: LaunchInput): void {
    const actor = this.actors.get(identity(input.key));
    if (!actor || !sameScope(actor.input.key, input.key) || actor.input.plan.specDigest !== input.plan.specDigest) {
      throw new SupervisorError('conflict');
    }
    actor.retire();
    this.actors.delete(identity(input.key));
  }
  /** Actual controller shutdown must settle telemetry closes before forgetting the actor. */
  async retireOwned(input: LaunchInput): Promise<void> {
    const actor = this.actors.get(identity(input.key));
    if (!actor || !sameScope(actor.input.key, input.key) || actor.input.plan.specDigest !== input.plan.specDigest) {
      throw new SupervisorError('conflict');
    }
    await actor.retireOwned(); this.retire(input);
  }
  /** Positive never-started Journal evidence is insufficient while any actual actor remains. */
  assertNoActor(key: Scope): void {
    if (this.actors.has(identity(key))) throw new SupervisorError('conflict');
  }
  /** Existing installation ownership and durable release bind this read-only native barrier. */
  async retireReleased(input: LaunchInput, operation: Operation): Promise<void> {
    const actor = this.actor(input);
    await actor.retireReleased(operation);
    this.retire(input);
  }
}
