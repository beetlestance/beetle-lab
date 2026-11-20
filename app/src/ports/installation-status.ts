import type { PoolUsage, RunQueueStatus, SlotUsage } from '@beetle/contracts/api';
import type { RunKey } from './runs.js';

export interface EngineVersionFact {
  readonly profileId: string;
  readonly id: string;
  readonly version: string;
  readonly imageDigest: string;
  readonly configVersion: number;
}
/** Last agent facts from one validated capabilities frame plus the backend disk sample. */
export interface AgentFacts {
  /** Oldest source time of the accepted sample (agent sample start or backend read start). */
  readonly observedAtMs: number;
  /** Raw Docker daemon/VM totals; null when the agent did not publish them. */
  readonly daemon: { readonly cpuMillis: number; readonly memoryBytes: number } | null;
  readonly stagingFreeBytes: number;
  readonly backendDisk: { readonly totalBytes: number; readonly availableBytes: number };
  /** Image digests the agent reported for the configured pins in that frame. */
  readonly imageDigests: readonly string[];
  readonly engines?: readonly EngineVersionFact[];
}
/** One finished capacity sample. Unreachable means no HTTP reply; unavailable means refused or invalid facts. */
export type AgentSampleOutcome =
  | { readonly kind: 'ready'; readonly checkedAtMs: number; readonly facts: AgentFacts }
  | { readonly kind: 'unreachable' | 'unavailable'; readonly checkedAtMs: number };
export interface AgentStatusRecorder {
  record(outcome: AgentSampleOutcome): void;
}
/** Process-local, in-memory view: restarts begin with no sample, which reads as unknown. */
export interface AgentStatusView {
  readonly last: AgentSampleOutcome | null;
  readonly lastFacts: AgentFacts | null;
  readonly engines: readonly {
    readonly profileId: string;
    readonly imageDigest: string;
    readonly id?: string;
    readonly configVersion?: number;
  }[];
}

/** Backend dispatch accounting: charged runs/exports and the effective pool mirror. */
export interface PoolUsageFacts {
  readonly pool: PoolUsage;
  readonly storage: { readonly chargedBytes: number; readonly allocationBytes: number; readonly reserveBytes: number };
}
export type RunQueueFacts = Omit<RunQueueStatus, 'generatedAt' | 'scope'>;
/** Counts that keep an upgrade from draining (docs/plans/proposed/in-place-upgrade.md). */
export interface UnfinishedWorkFacts {
  readonly runs: number;
  readonly exports: number;
  readonly uploads: number;
  readonly removals: number;
}
export interface InstallationStatusReader {
  poolUsage(): Promise<PoolUsageFacts>;
  runQueue(key: RunKey): Promise<RunQueueFacts>;
  unfinishedWork(): Promise<UnfinishedWorkFacts>;
}
export type { PoolUsage, RunQueueStatus, SlotUsage };
