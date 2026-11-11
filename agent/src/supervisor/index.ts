import { SamplingAdmission } from '../telemetry/index.js';
import { performance } from 'node:perf_hooks';
import { LaunchActor } from './actor.js';
import { identity, sameScope, validateInput } from './identity.js';
import { SupervisorError } from './types.js';
import type { LaunchInput, SupervisorOptions } from './types.js';
import type { Operation } from '../backends/docker/index.js';
export { SupervisorError };
export type { LaunchActor } from './actor.js';
export type { BackendPort, Clock, JournalPort, LaunchInput, LaunchState, SupervisorOptions } from './types.js';

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
    const actor = new LaunchActor(snapshot, this.options.journal, this.backend(),
      this.options.clock ?? { wall: Date.now, monotonic: () => performance.now() }, this.sampling);
    this.actors.set(key, actor);
    return actor;
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
  /** Existing installation ownership and durable release bind this read-only native barrier. */
  async retireReleased(input: LaunchInput, operation: Operation): Promise<void> {
    const actor = this.actor(input);
    await actor.retireReleased(operation);
    this.retire(input);
  }
}
