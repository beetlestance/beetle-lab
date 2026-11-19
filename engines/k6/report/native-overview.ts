import type { EngineResult } from '@beetle/contracts';
import { k6RequestsPerSecond } from '@beetle/contracts/k6-history';
import type { ReportWriter } from './writer.js';

export function appendNativeOverview(text: ReportWriter, evidence: NonNullable<EngineResult['nativeOverview']>): void {
  text.line('Verified native k6 summary. Metric windows and endpoint breakdown are unavailable.');
  const entries = [
    ['Test duration (ms)', evidence.durationMs],
    ['HTTP requests', evidence.requests],
    ['Average HTTP requests per second', k6RequestsPerSecond(evidence.requests, evidence.durationMs)],
    ['p50 latency (ms)', evidence.p50Ms],
    ['p95 latency (ms)', evidence.p95Ms],
    ['p99 latency (ms)', evidence.p99Ms],
    ['Failed HTTP sample ratio', evidence.failureRatio],
    ['Native check pass ratio', evidence.checkPassRatio],
    ['Dropped iterations', evidence.droppedIterations],
  ] as const;
  for (const [label, value] of entries) {
    if (value !== null) text.line(`${label}: ${value}`);
  }
}
