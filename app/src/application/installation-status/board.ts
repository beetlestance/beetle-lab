import type {
  AgentFacts,
  AgentSampleOutcome,
  AgentStatusRecorder,
  AgentStatusView,
} from '../../ports/installation-status.js';

/** In-memory last outcome plus last good facts; no history, no persistence, no I/O. */
export class AgentStatusBoard implements AgentStatusRecorder {
  private last: AgentSampleOutcome | null = null;
  private lastFacts: AgentFacts | null = null;
  private readonly engines: AgentStatusView['engines'];
  constructor(engines: AgentStatusView['engines']) {
    this.engines = Object.freeze(engines.map((pin) => Object.freeze({ ...pin })));
  }
  record(outcome: AgentSampleOutcome): void {
    // A clock rollback must not let an older sample masquerade as the latest one.
    if (this.last !== null && outcome.checkedAtMs < this.last.checkedAtMs) return;
    this.last = Object.freeze({ ...outcome });
    if (outcome.kind === 'ready') this.lastFacts = Object.freeze({ ...outcome.facts });
  }
  snapshot(): AgentStatusView {
    return Object.freeze({ last: this.last, lastFacts: this.lastFacts, engines: this.engines });
  }
}
