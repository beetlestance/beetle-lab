import type { RuntimeCeilings } from '../../../domain/settings/index.js';
import type { Bootstrap, RuntimeObservation } from './protocol.js';
import { requireRule } from '../../../domain/namespaces/index.js';
import { checkedRuntime } from './input.js';

/** Source timestamp is preserved across queueing; receipt time never refreshes age. */
export class RuntimeCapacity {
  private observation: RuntimeObservation | null;
  private previousNow: number;
  private readonly ttl: number;
  private rollbackFence = -1;
  constructor(bootstrap: Bootstrap) {
    this.observation = bootstrap.runtime;
    this.ttl = bootstrap.runtimeTtlMs ?? 5000;
    this.previousNow = Date.now();
  }
  update(observation: RuntimeObservation | null): null {
    if (this.currentTime() === null) return null;
    checkedRuntime(observation, this.ttl);
    requireRule(observation === null || observation.observedAtMs > this.rollbackFence);
    this.observation = observation;
    return null;
  }
  private currentTime(): number | null {
    const now = Date.now();
    if (!Number.isSafeInteger(now) || now < this.previousNow) {
      this.observation = null;
      this.rollbackFence = Math.max(this.rollbackFence, this.previousNow);
      return null;
    }
    this.previousNow = now;
    return now;
  }
  snapshot(): RuntimeCeilings | null {
    const now = this.currentTime();
    if (now === null) return null;
    const observation = this.observation;
    if (observation === null) return null;
    const age = now - observation.observedAtMs;
    if (age < 0 || age > this.ttl) { this.observation = null; return null; }
    return observation.ceilings;
  }
}
