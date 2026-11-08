import type { Observation } from '../backends/docker/index.js';
import type { Scope } from '../admission/index.js';
import type { SupervisorInput } from '../journal/index.js';
import type { JournalPort, LaunchState } from './types.js';

type LifecycleKind = 'runtime.started' | 'cancellation.requested' | 'runtime.exited' | 'execution.lost';
type Draft = Extract<SupervisorInput['event'], { kind: LifecycleKind }>;
/** Capture never awaits delivery. One immutable first observation per lifecycle kind. */
export class RuntimeEvidence {
  // At most four entries, even if delivery fails indefinitely. Repeated inspections
  // coalesce to the first captured event; this generation can never restart.
  private readonly captured = new Set<LifecycleKind>();
  private readonly pending: { event: Draft; sourceOrdinal?: number }[] = [];
  constructor(private readonly journal: JournalPort, private readonly key: Scope) {}
  get hasPending(): boolean { return this.pending.length > 0; }
  private capture(event: Draft): void {
    if (this.captured.has(event.kind)) return;
    this.captured.add(event.kind);
    this.pending.push({ event });
  }
  async flush(): Promise<void> {
    while (this.pending.length) {
      const pending = this.pending[0]!;
      if (pending.sourceOrdinal === undefined) {
        const cursor = await this.journal.sourceCursors(this.key);
        pending.sourceOrdinal = cursor.supervisorOrdinal + 1;
      }
      await this.journal.appendSupervisor({ sourceOrdinal: pending.sourceOrdinal, event: pending.event });
      this.pending.shift();
    }
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
  private event(observation: Observation, now: number, cause: LaunchState['cancellation']): Draft | undefined {
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
