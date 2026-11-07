import type { Observation } from '../backends/docker/index.js';
import type { Scope } from '../admission/index.js';
import type { SupervisorInput } from '../journal/index.js';
import type { JournalPort, LaunchState } from './types.js';

type Draft = SupervisorInput['event'];
/** One serialized source stream. No wrapper events or outcome inference. */
export class RuntimeEvidence {
  private lastObservation = '';
  private cancellationWritten = false;
  private pending: { event: Draft; sourceOrdinal?: number; signature?: string } | undefined;
  constructor(private readonly journal: JournalPort, private readonly key: Scope) {}
  private async append(event: Draft, signature?: string): Promise<void> {
    await this.flush();
    this.pending = { event, ...(signature === undefined ? {} : { signature }) };
    await this.flush();
  }
  private async flush(): Promise<void> {
    const pending = this.pending;
    if (!pending) return;
    if (pending.sourceOrdinal === undefined) {
      const cursor = await this.journal.sourceCursors(this.key);
      pending.sourceOrdinal = cursor.supervisorOrdinal + 1;
    }
    await this.journal.appendSupervisor({ sourceOrdinal: pending.sourceOrdinal, event: pending.event });
    if (pending.signature !== undefined) this.lastObservation = pending.signature;
    if (pending.event.kind === 'cancellation.requested') this.cancellationWritten = true;
    this.pending = undefined;
  }
  async cancelled(requestedAt: number, now: number): Promise<void> {
    await this.flush();
    if (this.cancellationWritten) return;
    await this.append({ ...this.base(now), kind: 'cancellation.requested',
      payload: { requestedAt: new Date(requestedAt).toISOString() } });
    this.cancellationWritten = true;
  }
  async observe(observation: Observation, now: number, cause: LaunchState['cancellation']): Promise<void> {
    await this.flush();
    const signature = JSON.stringify(observation);
    if (signature === this.lastObservation) return;
    const event = this.event(observation, now, cause);
    if (event) await this.append(event, signature);
    this.lastObservation = signature;
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
    if (cause === 'cancelled' || cause === 'timeout') return { reason: cause };
    // The wire has no clock_integrity reason. The actor reports it separately.
    return {};
  }
}
