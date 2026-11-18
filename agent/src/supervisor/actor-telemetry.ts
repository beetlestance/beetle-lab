import type { AttemptResources } from '../telemetry/index.js';
import type { AttemptLiveMetrics } from './live.js';
import type { Observation, Operation } from '../backends/docker/index.js';
import type { RuntimeEvidence } from './evidence.js';
import type { AttemptTime } from './time.js';
import { SupervisorError } from './types.js';
interface TelemetryOptions {
  resources: AttemptResources | undefined;
  live: AttemptLiveMetrics;
  evidence: RuntimeEvidence;
  time: AttemptTime;
  observation(): Observation | null;
  fenced(): boolean;
  cancelled(): boolean;
  persistCancellation(): Promise<void>;
}
export class ActorTelemetry {
  private finalResources = false;
  constructor(private readonly options: TelemetryOptions) {}
  get resources() {
    return this.options.resources;
  }
  get live() {
    return this.options.live;
  }
  readLiveMetrics(operation: Operation) {
    if (this.options.fenced()) return Promise.resolve({ ok: false as const, reason: 'closed' as const });
    if (this.options.cancelled() || this.options.observation()?.state !== 'running')
      return Promise.resolve({ ok: false as const, reason: 'unavailable' as const });
    return this.options.live
      .read(operation)
      .then((result) =>
        this.options.fenced() || this.options.cancelled() || this.options.observation()?.state !== 'running'
          ? { ok: false as const, reason: 'closed' as const }
          : result,
      );
  }
  readLiveHistory(operation: Operation) {
    if (this.options.fenced()) return Promise.resolve({ ok: false as const, reason: 'closed' as const });
    if (this.options.cancelled() || this.options.observation()?.state !== 'running')
      return Promise.resolve({ ok: false as const, reason: 'unavailable' as const });
    return this.options.live
      .readHistory(operation)
      .then((result) =>
        this.options.fenced() || this.options.cancelled() || this.options.observation()?.state !== 'running'
          ? { ok: false as const, reason: 'closed' as const }
          : result,
      );
  }
  async closeTelemetry(): Promise<void> {
    const outcomes = await Promise.allSettled([this.options.resources?.close(), this.options.live.close()]);
    if (outcomes.some((value) => value.status === 'rejected')) throw new SupervisorError('backend_unavailable');
    await this.options.evidence.flush();
    if (this.options.evidence.hasPending) throw new SupervisorError('journal_unavailable');
  }
  private async captureResources(): Promise<void> {
    const terminal = this.options.observation()?.state === 'exited' || this.options.observation()?.state === 'missing';
    if (terminal && this.options.resources && !this.finalResources) {
      await this.options.resources.close();
      this.finalResources = true;
      const summary = this.options.resources.final();
      if (summary) this.options.evidence.summarize(summary, this.options.time.wall());
    } else this.publishResources();
  }
  private publishResources(): void {
    const summary = this.options.resources?.due();
    if (!summary) return;
    if (this.options.evidence.resourceWaiting) {
      this.options.resources!.coalesced();
      summary.missedSamples = Math.min(Number.MAX_SAFE_INTEGER, summary.missedSamples + 1);
    }
    this.options.evidence.summarize(summary, this.options.time.wall());
  }
  async deliver(): Promise<void> {
    await this.captureResources();
    const terminal = this.options.observation()?.state === 'exited' || this.options.observation()?.state === 'missing';
    const lifecycle = this.options.evidence.lifecyclePending;
    const delivery = this.options.evidence.flush(!terminal && lifecycle);
    if (!terminal && !lifecycle) {
      // Evidence owns the exact original. Periodic telemetry cannot hold the stop lane.
      void delivery.catch(() => undefined);
      return;
    }
    try {
      await delivery;
      if (!terminal && this.options.evidence.hasPending) void this.options.evidence.flush().catch(() => undefined);
    } catch {
      // Fence immediately; the next bounded cancel/tick step signals before retrying
      // delivery. A failed append can never authorize more execution or settlement.
      await this.options.persistCancellation();
      throw new SupervisorError('journal_unavailable');
    }
  }
  recordTelemetry(view: Observation, recovered: boolean): void {
    if (view.state === 'exited' || view.state === 'missing') void this.options.live.close().catch(() => undefined);
    if (view.state === 'running') {
      this.options.resources?.running(recovered);
      this.options.resources?.tick();
    }
  }
}
