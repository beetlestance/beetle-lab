import type { NativeWarnings } from '@beetle/contracts/k6-warnings';
import type { AttemptBudget } from '../../runtime/index.js';

export type ProcessCause = 'cancelled' | 'closed' | 'deadline' | 'clock' | 'profile'
  | 'spawn' | 'child_error' | 'metric_limit' | 'diagnostic_limit' | 'stream' | 'sink'
  | 'descendants' | 'drain_timeout';
export interface MetricDelivery {
  readonly signal: AbortSignal;
  readonly deadlineMs: number;
}
export interface NativeProcessOptions {
  readonly binary: string;
  readonly emptyConfig: string;
  readonly directory: string;
  readonly script: string;
  readonly attempt: AttemptBudget;
  readonly maxMetricStreamBytes: number;
  readonly maxDiagnosticBytes: number;
  readonly drainTimeoutMs: number;
  readonly sink: (bytes: Readonly<Uint8Array>, delivery: MetricDelivery) => Promise<void>;
  readonly signal?: AbortSignal;
  readonly clock?: { wall: () => number; monotonic: () => number };
}
export interface ProcessObservation {
  readonly warnings?: NativeWarnings;
  readonly spawned: boolean;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly cause: ProcessCause | null;
  readonly metricBytes: number;
  readonly diagnosticBytes: number;
  readonly collection: 'complete' | 'partial';
  readonly state: 'stopped' | 'unknown' | 'not_started';
  readonly stdioClosed: boolean;
  readonly groupAbsent: boolean;
  readonly quiescent: boolean;
}
export interface NativeProcess {
  run(): Promise<ProcessObservation>;
  /** Fences launch and awaits all issued profile/sink work, even after an unknown observation. */
  close(): Promise<void>;
}
export class ProcessBoundaryError extends Error {
  constructor(readonly code: 'profile' | 'clock' | 'deadline') { super(code); this.name = 'ProcessBoundaryError'; }
}
