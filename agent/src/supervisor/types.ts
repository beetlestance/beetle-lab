import type { DockerBackend, Observation, RuntimePlan } from '../backends/docker/index.js';
import type { Journal, StopReason } from '../journal/index.js';
import type { Scope } from '../admission/index.js';

export type JournalPort = Pick<Journal, 'admission' | 'readOffer' | 'supervision' | 'sourceCursors' | 'appendSupervisor'>;
export type BackendPort = Pick<DockerBackend, 'ensureCreated' | 'dispatchStartOnce' | 'inspect' | 'stop' | 'kill'>;
export interface Clock { wall(): number; monotonic(): number }
export interface SupervisorOptions {
  journal: JournalPort; backendFactory(): BackendPort; installationId: string; clock?: Clock;
}
export interface LaunchInput { key: Scope; plan: RuntimePlan }
export interface LaunchState {
  observation: Observation | null;
  launch: 'unclaimed' | 'unknown' | 'completed' | 'retired';
  cancellation: 'none' | StopReason;
}
export type SupervisorErrorCode = 'invalid_input' | 'conflict' | 'capacity' | 'journal_unavailable' | 'backend_unavailable' | 'closed';
export class SupervisorError extends Error {
  constructor(readonly code: SupervisorErrorCode) { super(`Supervisor ${code}`); this.name = 'SupervisorError'; }
}
