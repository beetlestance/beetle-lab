import type { RuntimeCeilings } from '../domain/settings/index.js';

/** Private combined capacity fact: absolute source expiry is never receipt time. */
export interface RuntimeObservation {
  ceilings: RuntimeCeilings;
  observedAtMs: number;
  expiresAtMs: number;
}

/** One original sample at a time. Unknown does not authorize dispatch. */
export interface CapacitySource {
  sample(signal?: AbortSignal): Promise<RuntimeObservation | null>;
  close(): Promise<void>;
}
