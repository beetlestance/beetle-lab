import type { RuntimeCeilings } from '../domain/settings/index.js';
import type { AgentConnectionConfiguration, RunnerGateway } from './runner.js';

/** Private combined capacity fact: absolute source expiry is never receipt time. */
export interface RuntimeObservation {
  readonly journalAuthority: string;
  ceilings: RuntimeCeilings;
  execution: { stagingBytes: number; perRunStagingBytes: number };
  observedAtMs: number;
  expiresAtMs: number;
}

/** One original sample at a time. Unknown does not authorize dispatch. */
export interface CapacitySource {
  sample(signal?: AbortSignal): Promise<RuntimeObservation | null>;
  close(): Promise<void>;
}

/** Canonical existing backend data path, never an HTTP-supplied location. */
export interface CapacitySourceOptions {
  readonly dataRoot: string;
  readonly configuration: AgentConnectionConfiguration;
  readonly gateway: RunnerGateway;
}
