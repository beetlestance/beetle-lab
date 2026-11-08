import type { CompiledSuite, DeepReadonly, MetricKind, MetricScope, MetricProvenance } from '../../plan/index.js';
import type { ProcessObservation } from '../process/index.js';

export interface SummaryOptions {
  readonly outputDirectory: string;
  readonly uid: number;
  readonly compiledSuite: DeepReadonly<CompiledSuite>;
  readonly process: ProcessObservation;
  readonly deadlineMs: number;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  readonly wallNow?: () => number;
}
export interface MetricEvidence {
  readonly kind: MetricKind;
  readonly nativeKey: string;
  readonly scope: MetricScope;
  readonly provenance: MetricProvenance;
  readonly values: Readonly<Record<string, number>>;
  readonly missingStats: readonly string[];
  readonly thresholds: readonly { readonly expression: string; readonly ok: boolean | null }[];
}
export interface SummaryEvidence {
  readonly version: 2;
  readonly timing: Readonly<{ testRunDurationMs: number | null }>;
  readonly metrics: Readonly<Record<string, MetricEvidence>>;
  readonly rawBytes: number;
  readonly sha256: string;
  readonly nativeCollection: ProcessObservation['collection'];
}
export type SummaryCode = 'profile' | 'process' | 'filesystem' | 'integrity' | 'limit' | 'invalid'
  | 'cancelled' | 'closed' | 'clock' | 'deadline';
export type SummaryResult = { readonly ok: true; readonly evidence: SummaryEvidence }
  | { readonly ok: false; readonly code: SummaryCode; readonly closeFailed: boolean };
export interface SummaryCollection {
  readonly result: Promise<SummaryResult>;
  readonly quiesced: Promise<void>;
  close(): Promise<void>;
}
export class SummaryError extends Error {
  constructor(readonly code: SummaryCode) { super(code); this.name = 'SummaryError'; }
}
