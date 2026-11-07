import type { RuntimeCeilings } from '../../../domain/settings/index.js';
import type { Bootstrap, RuntimeObservation } from './protocol.js';

/** Source timestamp is preserved across queueing; receipt time never refreshes age. */
export class RuntimeCapacity {
  private observation: RuntimeObservation | null;
  private previousNow: number;
  private readonly ttl: number;
  constructor(bootstrap: Bootstrap) {
    this.observation = bootstrap.runtime;
    this.ttl = bootstrap.runtimeTtlMs ?? 5000;
    this.previousNow = Date.now();
  }
  update(observation: RuntimeObservation | null): null {
    // A rollback invalidates an old observation even when an update arrives.
    this.snapshot();
    this.observation = observation;
    return null;
  }
  snapshot(): RuntimeCeilings | null {
    const now = Date.now();
    if (!Number.isSafeInteger(now) || now < this.previousNow) { this.observation = null; return null; }
    this.previousNow = now;
    const observation = this.observation;
    if (observation === null) return null;
    const age = now - observation.observedAtMs;
    if (age < 0 || age > this.ttl) { this.observation = null; return null; }
    return observation.ceilings;
  }
}
