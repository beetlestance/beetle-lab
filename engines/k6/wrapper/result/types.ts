import type { EngineResult } from '@beetle/contracts';
import type { CompiledSuite, DeepReadonly } from '../../plan/index.js';
import type { MetricSnapshot } from '../../aggregation/index.js';
import type { SummaryEvidence } from '../collection/index.js';
import type { JournalScope } from '../control/index.js';
import type { ProcessObservation } from '../process/index.js';

type Unsealed<T> = T extends unknown ? Omit<T, 'seal'> : never;
export type K6ResultBody = DeepReadonly<Unsealed<EngineResult>>;
export type OrchestrationFailure = 'cancelled' | 'deadline' | 'clock' | 'profile' | 'build'
  | 'native' | 'metrics' | 'summary' | 'cleanup' | 'closed';
export interface K6ResultInput {
  readonly suite: DeepReadonly<CompiledSuite>;
  readonly scope: JournalScope;
  readonly process: ProcessObservation;
  /** Whole wrapper work/cleanup, distinct from the native child's observation. */
  readonly orchestrationFailure: OrchestrationFailure | null;
  readonly orchestrationQuiescent: boolean;
  /** Trusted terminal confirmation time, not a source sample or native duration. */
  readonly terminalObservedAt: string;
  readonly summary: SummaryEvidence | null;
  readonly metrics: MetricSnapshot | null;
  readonly artifacts: readonly EngineResult['artifacts'][number][];
}
export type K6ResultMapping = Readonly<{ ok: true; body: K6ResultBody;
  diagnostics: Readonly<{ windowCoverage: MetricSnapshot['windowCoverage'] | null }> }>
  | Readonly<{ ok: false; code: 'not_quiescent' | 'invalid_input' }>;
export interface AssertionEvidence {
  readonly counts: EngineResult['requiredAssertions'];
  readonly failureEvaluations: number | null;
  readonly knownFailureEvaluations: number;
  readonly contradictory: boolean;
}
export interface ThresholdEvidence {
  readonly verdicts: EngineResult['thresholds'][number][];
  readonly complete: boolean;
  readonly sloFailed: boolean;
  readonly expectedAbort: { ruleId: string; reached: boolean } | null;
}
export interface HealthEvidence {
  readonly required: number | null;
  readonly execution: number | null;
  readonly requiredFailure: boolean;
  readonly complete: boolean;
  readonly contradictory: boolean;
}
