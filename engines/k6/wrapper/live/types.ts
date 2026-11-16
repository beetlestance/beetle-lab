import type { LiveMetricHash, LiveMetricScope, LiveMetricSubset } from '@beetle/contracts/api';
import type { MetricWindow } from '@beetle/contracts/metrics';

export type LiveMetricFailure = 'invalid_input' | 'clock' | 'quota' | 'deadline' | 'sink' | 'cleanup';
/** Trusted port: write/close promises own the actual originals through settlement. */
export interface LiveMetricSink {
  write(bytes: Uint8Array, signal: AbortSignal): Promise<void>;
  close(): Promise<void>;
}
export interface LiveMetricClock { wall(): number; monotonic(): number }
export interface LiveMetricPublisherOptions {
  readonly scope: LiveMetricScope;
  readonly producerEpoch: string;
  readonly subset: LiveMetricSubset;
  readonly hash: LiveMetricHash;
  readonly timeoutMs: number;
  readonly maximumProducedBytes: number;
  readonly sink: LiveMetricSink;
  readonly clock?: LiveMetricClock;
  readonly signal?: AbortSignal;
}
export interface LiveMetricPublisherState {
  readonly status: 'open' | 'stopping' | 'closed' | 'failed';
  readonly reason: LiveMetricFailure | null;
  readonly sourceSequence: number;
  readonly publishedSequence: number;
  readonly coalescedWindows: number;
  readonly discardedOnStop: 0 | 1;
  readonly pending: boolean;
  readonly writing: boolean;
  /** Conservative full-buffer charge made before each write, not measured disk bytes. */
  readonly chargedBytes: number;
}
export interface LiveMetricCloseResult {
  readonly quiescence: 'confirmed' | 'failed';
  readonly state: Readonly<LiveMetricPublisherState>;
}
export interface LiveMetricPublisher {
  /** True means admitted to the latest slot, not published or authoritative. */
  accept(window: MetricWindow): boolean;
  state(): Readonly<LiveMetricPublisherState>;
  /** Fences synchronously; both methods return the same retained completion promise. */
  stop(): Promise<LiveMetricCloseResult>;
  close(): Promise<LiveMetricCloseResult>;
}
export class LiveMetricPublisherError extends Error {
  constructor(readonly code: 'invalid_options') { super('Live metric publisher rejected'); this.name = 'LiveMetricPublisherError'; }
}
