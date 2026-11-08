import type { BuildOutput } from '../../build/index.js';
import type { AccumulatorCode, MetricSnapshot, MetricStreamError, MetricWindow } from '../../aggregation/index.js';
import type { CompiledInput } from '../input/index.js';
import type { ProcessObservation } from '../process/index.js';
import type { SummaryResult } from '../collection/index.js';

export interface ExecutionLimits {
  readonly maximumBuildBytes: number;
  readonly reservedOutputBytes: number;
  readonly maximumMetricBytes: number;
  readonly maximumMetricRecords: number;
  readonly maximumDiagnosticBytes: number;
  readonly drainTimeoutMs: number;
  readonly collectionTimeoutMs: number;
}
export interface ExecutionClock { readonly wall: () => number; readonly monotonic: () => number }
export interface MeasurementReceipt { readonly sourceTimeMs: number; readonly observedAt: string }
export interface ExecutionOptions {
  readonly compiled: CompiledInput;
  readonly binary: string;
  readonly emptyConfig: string;
  readonly outputDirectory: string;
  readonly uid: number;
  readonly limits: ExecutionLimits;
  readonly window: (window: MetricWindow, signal: AbortSignal) => Promise<void>;
  readonly measureStarted: (receipt: MeasurementReceipt, signal: AbortSignal) => Promise<void>;
  readonly signal?: AbortSignal;
  readonly clock?: ExecutionClock;
}
export type ExecutionCode = 'profile' | 'build' | 'native' | 'metrics' | 'summary'
  | 'cancelled' | 'deadline' | 'clock' | 'closed' | 'cleanup';
export type MetricFailure = Readonly<{ source: 'decoder'; code: MetricStreamError['code'] }>
  | Readonly<{ source: 'accumulator'; code: AccumulatorCode }>
  | Readonly<{ source: 'callback'; code: 'sink_failed' }>
  | Readonly<{ source: 'composition'; code: 'byte_count' }>;
export interface ExecutionEvidence {
  readonly build: BuildOutput | null;
  readonly process: ProcessObservation | null;
  readonly terminalObservedAt: string | null;
  readonly summary: SummaryResult | null;
  readonly metrics: MetricSnapshot | null;
  readonly stream: Readonly<{ bytes: number; records: number }> | null;
  readonly metricFailure: MetricFailure | null;
}
/** ok records complete pipeline collection, never a test outcome. */
export type ExecutionReceipt = ExecutionEvidence & ({ readonly ok: true }
  | { readonly ok: false; readonly code: ExecutionCode });
export interface ExecutionOperation {
  readonly result: Promise<ExecutionReceipt>;
  /** Latest actual facts after original cleanup settles; preserves the first result outcome. */
  readonly final: Promise<ExecutionReceipt>;
  /** Retains every original issued operation and close, including late failures. */
  readonly quiesced: Promise<void>;
  close(): Promise<void>;
}
export class ExecutionError extends Error {
  constructor(readonly code: ExecutionCode) { super('Native execution boundary rejected'); this.name = 'ExecutionError'; }
}
