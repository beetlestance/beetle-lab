import type { Offer } from '@beetle/contracts';
import { LiveMetricReader } from '../live-metrics/index.js';
import type { LiveMetricRead } from '../live-metrics/index.js';
import type { Operation } from '../backends/docker/index.js';
import type { SamplingAdmission } from '../telemetry/index.js';
import type { BackendPort, Clock, LaunchInput, LiveMetricApprovalFactory } from './types.js';

/** Advisory state only; approval failure never changes launch or test outcome. */
export class AttemptLiveMetrics {
  private reader: LiveMetricReader | undefined;
  private attempted = false;
  private closed = false;
  constructor(private readonly options: {input: LaunchInput; backend: BackendPort; clock: Clock;
    admission: SamplingAdmission; approve?: LiveMetricApprovalFactory}) {}
  approve(offer: Offer): void {
    if (this.attempted || this.closed) return;
    this.attempted = true;
    if (!this.options.backend.readMailbox || !this.options.approve) return;
    try {
      const approval = this.options.approve(offer, this.options.input);
      if (approval) this.reader = new LiveMetricReader({approval, clock: this.options.clock,
        read: operation => this.options.backend.readMailbox!(this.options.input.plan, operation)});
    } catch { /* Trusted policy rejection disables this advisory channel. */ }
  }
  get pending(): boolean { return this.reader?.pending ?? false; }
  read(operation: Operation): Promise<LiveMetricRead> {
    if (this.closed) return Promise.resolve({ok: false, reason: 'closed'});
    if (!this.reader) return Promise.resolve({ok: false, reason: 'unavailable'});
    const release = this.options.admission.acquire();
    if (!release) return Promise.resolve({ok: false, reason: 'busy'});
    return this.reader.read(operation).finally(release);
  }
  close(): Promise<void> { this.closed = true; return this.reader?.close() ?? Promise.resolve(); }
}
