import type { JournalRejectedFunding } from '../journal/index.js';
import type { RetirementIntent, JournalRetirements } from '../retirement-values/index.js';
import type { ProducerGate } from '../producer-gate/index.js';
import type { InstallationController } from '../installation/index.js';
declare const barrier: unique symbol;
/** Producer quiescence only; C3 needs independent current native custody/removal authority. */
export interface ProducerBarrier { readonly [barrier]: true }
export type RetirementReason = 'invalid_input' | 'capacity' | 'conflict' | 'expired' | 'closed' | 'unavailable' | 'cleanup';
export class ProducerRetirementError extends Error {
  constructor(readonly reason: RetirementReason) { super(`Producer retirement ${reason}`); }
}
export type RetirementOutcome = { readonly ok: true; readonly value: ProducerBarrier }
  | { readonly ok: false; readonly reason: RetirementReason };
export interface RetirementWork {
  readonly result: Promise<RetirementOutcome>;
  /** Issued promise carriers have settled. Rejected cleanup still retains ownership and grants no proof. */
  readonly settled: Promise<void>;
}
export interface ProducerRetirementOptions {
  readonly journal: JournalRetirements;
  readonly funding?:Pick<JournalRejectedFunding,'select'|'fundRejected'>;
  readonly gate: ProducerGate;
  readonly installation: Pick<InstallationController, 'retireOutput'>;
  readonly monotonicNow?: () => number;
  /** Trusted composition/test ceiling, never job-supplied; default30s, maximum30s. */
  readonly budgetMs?: number;
}
export interface BarrierFacts { readonly intent: RetirementIntent }
