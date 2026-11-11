import type { ResourceSummary } from '../telemetry/index.js';
import type { Observation } from '../backends/docker/index.js';
import type { Scope } from '../admission/index.js';
import type { SupervisorInput } from '../journal/index.js';
import type { JournalPort, LaunchState } from './types.js';

type LifecycleKind = 'runtime.started' | 'cancellation.requested' | 'runtime.exited' | 'execution.lost';
type Draft = Extract<SupervisorInput['event'], { kind: LifecycleKind | 'resource.summary' }>;
type Pending = { event: Draft; input?: SupervisorInput };
/** Capture never awaits delivery. One immutable first observation per lifecycle kind. */
export class RuntimeEvidence {
  // At most four entries, even if delivery fails indefinitely. Repeated inspections
  // coalesce to the first captured event; this generation can never restart.
  private readonly captured = new Set<LifecycleKind>();
  private readonly pending: Pending[] = [];
  private resource: Pending | undefined;
  private issued: Pending | undefined;
  private flushing: Promise<void> | undefined;
  private sealed = false;
  constructor(private readonly journal: JournalPort, private readonly key: Scope) {}
  get hasPending(): boolean { return Boolean(this.pending.length || this.resource || this.issued || this.flushing); }
  get lifecyclePending(): boolean {
    return this.pending.length > 0 || this.issued !== undefined && this.issued.event.kind !== 'resource.summary';
  }
  get resourceWaiting(): boolean { return this.resource !== undefined; }
  summarize(payload: ResourceSummary, now: number): void {
    if (this.sealed) return;
    Object.freeze(payload.enforcedControls);
    this.resource = { event: this.freeze({ ...this.base(now), kind: 'resource.summary', payload }) };
  }
  private capture(event: Extract<Draft, { kind: LifecycleKind }>): void {
    if (this.sealed || this.captured.has(event.kind)) return;
    this.captured.add(event.kind);
    this.pending.push({ event: this.freeze(event) });
  }
  private freeze(event: Draft): Draft { Object.freeze(event.payload); return Object.freeze(event); }
  flush(lifecycleOnly = false): Promise<void> {
    if (this.flushing) return this.flushing;
    const work = Promise.resolve().then(() => this.drain(lifecycleOnly)).finally(() => { this.flushing = undefined; });
    this.flushing = work; return work;
  }
  private next(): Pending | undefined {
    // An issued uncertain append always replays first. Exit follows the final summary.
    if (this.issued) return this.issued;
    const lifecycle = this.pending[0];
    if (lifecycle && (lifecycle.event.kind !== 'runtime.exited' || !this.resource)) {
      this.issued = this.pending.shift();
      if (lifecycle.event.kind === 'runtime.exited') this.sealed = true;
    } else {
      this.issued = this.resource; this.resource = undefined;
    }
    return this.issued;
  }
  private async drain(lifecycleOnly: boolean): Promise<void> {
    let pending: Pending | undefined;
    while (!lifecycleOnly || this.lifecyclePending) {
      pending = this.next();
      if (!pending) return;
      try {
        if (pending.input === undefined) {
          const cursor = await this.journal.sourceCursors(this.key);
          pending.input = Object.freeze({ sourceOrdinal: cursor.supervisorOrdinal + 1, event: pending.event });
        }
        await this.journal.appendSupervisor(pending.input);
        if (pending.event.kind === 'runtime.exited') this.sealed = true;
        this.issued = undefined;
      } catch (error) {
        if (!pending.input) this.deferUnissued(pending);
        // Telemetry retains exact uncertain intent without cancelling a healthy runtime.
        // Lifecycle and final closure may not pass unresolved ordinal ownership.
        if (pending.event.kind !== 'resource.summary' || this.pending.length) throw error;
        return;
      }
    }
  }
  private deferUnissued(pending: Pending): void {
    this.issued = undefined;
    if (pending.event.kind === 'resource.summary') this.resource ??= pending;
    else this.pending.unshift(pending);
  }
  cancelled(requestedAt: number, now: number): void {
    this.capture({ ...this.base(now), kind: 'cancellation.requested',
      payload: { requestedAt: new Date(requestedAt).toISOString() } });
  }
  observe(observation: Observation, now: number, cause: LaunchState['cancellation']): void {
    const event = this.event(observation, now, cause);
    if (event) this.capture(event);
  }
  private base(now: number) {
    return { version: '1.0' as const, ...this.key, source: 'agent' as const,
      phase: 'execute' as const, observedAt: new Date(now).toISOString() };
  }
  private event(observation: Observation, now: number, cause: LaunchState['cancellation']): Extract<Draft, { kind: LifecycleKind }> | undefined {
    const base = this.base(now);
    if (observation.state === 'missing') return { ...base, kind: 'execution.lost',
      payload: { reason: 'execution_lost', lastObservedAt: base.observedAt } };
    if (!('id' in observation)) return undefined;
    if (observation.state === 'running') return { ...base, kind: 'runtime.started', payload: { runtimeId: observation.id } };
    if (observation.state !== 'exited') return undefined;
    return { ...base, kind: 'runtime.exited', payload: { exitCode: observation.exitCode,
      oomKilled: observation.oomKilled, observedAt: base.observedAt,
      ...(observation.oomKilled ? { reason: 'memory_limit' as const } : this.exitCause(cause)) } };
  }
  private exitCause(cause: LaunchState['cancellation']) {
    if (cause === 'cancelled' || cause === 'timeout' || cause === 'output_limit' || cause === 'artifact_incomplete') return { reason: cause };
    // The wire has no clock_integrity reason. The actor reports it separately.
    return {};
  }
}
