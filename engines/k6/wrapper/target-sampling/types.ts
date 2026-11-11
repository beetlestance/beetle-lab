export interface TargetSamplingConfig {
  readonly path: string;
  readonly intervalMs: number;
  readonly timeoutMs: number;
  readonly cooldownMs: number;
}
export type TargetSamplingPhase = 'before' | 'during' | 'after';
export type TargetSamplingReason = 'http' | 'invalid_json' | 'body_limit'
  | 'timeout' | 'transport' | 'cancelled';
export interface TargetSamplingSample {
  readonly observedAt: string;
  readonly phase: TargetSamplingPhase;
  readonly status: 'ready' | 'unavailable';
  readonly reason: TargetSamplingReason | null;
  readonly values: Readonly<Record<TargetMetricName, number | null>>;
}
export interface TargetSamplingReport {
  readonly format: 'beetle-target-runtime';
  readonly version: 1;
  readonly scope: 'target-reported';
  readonly samples: readonly TargetSamplingSample[];
  readonly limited: boolean;
  /** Unavailable attempts and the first observation refused by retention limits. */
  readonly missed: number;
}
export interface TargetSamplingOptions {
  readonly target: string;
  readonly config: TargetSamplingConfig;
  readonly signal: AbortSignal;
  readonly fetch?: typeof globalThis.fetch;
}
export interface TargetSamplingOwner {
  finish(): Promise<TargetSamplingReport>;
  close(): Promise<void>;
}
export const targetMetricNames = [
  'heapAlloc', 'heapInuse', 'heapIdle', 'heapSys', 'heapReleased', 'heapObjects',
  'stackInuse', 'rss', 'external', 'arrayBuffers', 'totalHeapSize', 'usedHeapSize',
  'heapSizeLimit', 'mallocedMemory', 'peakMallocedMemory', 'goroutines',
  'activeRequests', 'numCPU', 'totalMemory', 'freeMemory', 'uptime', 'cpuPercent',
  'systemCpuPercent', 'uvThreadpoolSize', 'cppHeap.allocated_size', 'cppHeap.used_size',
  'eventLoopDelay.mean', 'eventLoopDelay.p90', 'eventLoopDelay.p99',
  'eventLoopDelay.max', 'gc.count', 'gc.duration',
] as const;
export type TargetMetricName = typeof targetMetricNames[number];
