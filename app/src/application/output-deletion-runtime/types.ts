import type { OutputSettlementMetadata } from '../../ports/output-settlement-metadata.js';
import type { RunnerSettlementGateway } from '../../ports/runner-settlement.js';
import type { RunnerRetirementGateway } from '../../ports/runner-retirement.js';
import type { OutputDeletionMetadata } from '../../ports/output-deletion-metadata.js';
import type { OutputDeletionStore } from '../../ports/output-deletion.js';
export type DeletionProgress = Pick<
  OutputDeletionMetadata,
  'scan' | 'getFile' | 'recordPlan' | 'recordAbsence' | 'reserveControl'
>;
export interface RetirementProgress {
  readonly metadata: Pick<
    OutputDeletionMetadata,
    'scanRetirements' | 'reserveControl' | 'retirementRequest' | 'recordCleanupAck'
  >;
  readonly gateway: RunnerRetirementGateway;
  readonly digest: (value: string) => string;
}
export interface SettlementProgress {
  readonly metadata: Pick<
    OutputDeletionMetadata,
    'scanSettlements' | 'reserveControl' | 'retirementRequest' | 'cleanupAck'
  >;
  readonly store: OutputSettlementMetadata;
  readonly gateway: RunnerSettlementGateway;
  readonly digest: (value: string) => string;
}
export interface ReclaimProgress {
  readonly metadata: Pick<OutputDeletionMetadata, 'reclaimRetired'>;
  /** Wall clock in epoch milliseconds; stamps requestedAt and paces idle passes. */
  readonly clock: () => number;
}
export interface OutputDeletionRuntimeOptions {
  /** Retired-workspace intent creation; requires settlement so begun work can finish. */
  readonly reclaim?: ReclaimProgress;
  readonly settlement?: SettlementProgress;
  /** Explicit isolated embedding; production composition supplies retirement instead. */
  readonly fileOnly?: true;
  readonly retirement?: RetirementProgress;
  readonly metadata: DeletionProgress;
  readonly files: OutputDeletionStore;
  readonly freeSpaceReserveBytes: number;
  readonly intervalMs?: number;
  /** Must not await this child's or its parent's close from the callback. */
  readonly onFailure: (error: unknown) => Promise<void>;
}
export interface OutputDeletionRuntime {
  close(): Promise<void>;
}
