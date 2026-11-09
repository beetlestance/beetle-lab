import { encodeCanonicalJson } from '@beetle/contracts';
import type { RuntimeCeilings } from '../../../domain/settings/index.js';
import type { Bootstrap, RuntimeObservation } from './protocol.js';
import { immutableSnapshot, requireRule } from '../../../domain/namespaces/index.js';
import { checkedRuntime } from './input.js';
import { boundedCopy, MAX_MESSAGE_BYTES } from './input-values.js';

/** Original source leases survive queueing. Revocation never creates a new measurement. */
export class RuntimeCapacity {
  private observation: RuntimeObservation | null = null;
  private previousNow = -1;
  private readonly ttl: number;
  private sourceHighWater = -1;
  private revokedThrough = -1;
  constructor(bootstrap: Bootstrap) {
    this.ttl = bootstrap.runtimeTtlMs ?? 5000;
    requireRule(Number.isSafeInteger(this.ttl) && this.ttl >= 1 && this.ttl <= 60000);
    this.update(bootstrap.runtime);
  }
  update(input: RuntimeObservation | null): null {
    const now = this.currentTime();
    if (now === null) { requireRule(input === null); return null; }
    const observation = boundedCopy(input);
    checkedRuntime(observation, this.ttl);
    this.expire(now);
    if (observation === null) { this.revoke(); return null; }
    if (observation.observedAtMs < this.sourceHighWater) {
      this.revoke(); requireRule(false);
    }
    requireRule(observation.observedAtMs > this.revokedThrough);
    if (observation.observedAtMs === this.sourceHighWater) {
      const equal = this.observation !== null &&
        encodeCanonicalJson(observation, MAX_MESSAGE_BYTES) === encodeCanonicalJson(this.observation, MAX_MESSAGE_BYTES);
      if (!equal) { this.revoke(); requireRule(false); }
      return null;
    }
    this.sourceHighWater = observation.observedAtMs;
    this.observation = immutableSnapshot(observation);
    return null;
  }
  private revoke(): void {
    this.observation = null;
    this.revokedThrough = Math.max(this.revokedThrough, this.sourceHighWater, this.previousNow);
  }
  private currentTime(): number | null {
    const now = Date.now();
    if (!Number.isSafeInteger(now) || now < 0 || now > 8640000000000000 || now < this.previousNow) {
      this.revoke(); return null;
    }
    this.previousNow = now;
    return now;
  }
  private expire(now: number): void {
    const observation = this.observation;
    if (observation !== null && (now < observation.observedAtMs || now >= observation.expiresAtMs ||
      now - observation.observedAtMs >= this.ttl)) this.revoke();
  }
  snapshot(): RuntimeCeilings | null {
    const now = this.currentTime();
    if (now === null) return null;
    this.expire(now);
    return this.observation?.ceilings ?? null;
  }
}
