import type { LiveMetricScope, LiveMetricSubset } from '../api/index.js';

export interface K6LiveAssignment {
  readonly specDigest: string;
  readonly intentDigest: string;
}
export interface K6LiveApproval {
  readonly scope: LiveMetricScope;
  readonly producerEpoch: string;
  readonly subset: LiveMetricSubset;
  /** Validated config `targetSampling.intervalMs`, or null when the suite samples no target. */
  readonly targetIntervalMs: number | null;
}
