import type { K6ResultInput } from '../../wrapper/result/index.js';
import { compiled } from '../suite/fixtures.js';
import { configFor } from '../runtime/fixtures.js';
import { metricEvidenceLayout, metricLayout, nativeMetricKey } from '../../plan/index.js';

export type Mutable<T> = T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
export function fixture(config = configFor()): Mutable<K6ResultInput> {
  config.requests[0]!.assertions = [
    { id: 'status', kind: 'statusEq', required: true, value: 200 },
    { id: 'optional', kind: 'statusEq', required: false, value: 201 },
    { id: 'body', kind: 'bodyContains', required: true, value: 'ok' },
  ];
  const suite = compiled(config);
  const metrics = Object.fromEntries(metricEvidenceLayout(suite).metrics.map(item => [item.key, {
    kind: item.kind, nativeKey: item.nativeKey, scope: item.scope, provenance: item.provenance,
    values: item.kind === 'counter' ? { count: 0, rate: 0 } : item.kind === 'trend'
      ? { count: 2, avg: 5, min: 5, max: 5, med: 5, 'p(50)': 5, 'p(90)': 5, 'p(95)': 5, 'p(99)': 5 }
      : item.kind === 'rate' ? { rate: 0, passes: 0, fails: 2 } : { value: 1, min: 1, max: 1 }, missingStats: [],
    thresholds: item.thresholds.map(rule => ({ expression: rule.threshold, ok: true })),
  }]));
  const input = { suite, scope: {
    organizationId: '00000000-0000-4000-8000-000000000001', workspaceId: '00000000-0000-4000-8000-000000000002',
    attemptId: '00000000-0000-4000-8000-000000000003', generation: 1 },
  process: { spawned: true, exitCode: 0, signal: null, cause: null, metricBytes: 1000, diagnosticBytes: 0,
    collection: 'complete', state: 'stopped', stdioClosed: true, groupAbsent: true, quiescent: true },
  orchestrationFailure: null, orchestrationQuiescent: true,
  terminalObservedAt: '2026-01-01T00:00:00Z',
  summary: { version: 2, metrics, timing: { testRunDurationMs: 2000 }, rawBytes: 1000, sha256: '1'.repeat(64), nativeCollection: 'complete' },
  metrics: { totals: [], totalsComplete: true, measurement: { complete: true, sourceTimeMs: 1000 },
    windowCoverage: { complete: true, latePoints: 0, markerDelayDroppedBuckets: 0 }, quantiles: 'unknown' }, artifacts: [] };
  const result = structuredClone(input) as Mutable<K6ResultInput>;
  count(result, 'beetle_measure_started', 1);
  const layout = metricLayout(suite);
  for (const request of layout.requests) {
    count(result, nativeMetricKey('beetle_requests', { request: request.label }), 2);
    for (const assertion of request.assertions) {
      count(result, nativeMetricKey('beetle_assertions', { assertion: assertion.label }), 2);
    }
  }
  return result;
}
export function count(input: Mutable<K6ResultInput>, key: string, value: number | null): void {
  const metric = input.summary!.metrics[key]!;
  if (value === null) delete metric.values.count;
  else metric.values.count = value;
}
export function threshold(input: Mutable<K6ResultInput>, key: string, expression: string, ok: boolean | null): void {
  const rule = input.summary!.metrics[key]!.thresholds.find(rule => rule.expression === expression);
  if (!rule) throw new Error('Unknown fixture threshold');
  rule.ok = ok;
}
export function discoveryConfig() {
  const config = configFor();
  config.loadPlan.scenarios = [{ id: 'main', name: 'main', executor: 'ramp-until', startTime: '0s', gracefulStop: '0s',
    startRate: 1, maxRate: 2, stepRate: 1, stepDuration: '1s', timeUnit: '1s', preAllocatedVUs: 1, maxVUs: 2,
    stopRule: { id: 'stop', metric: 'http_req_duration', stat: 'p95', operator: '>', value: 10 } }];
  return config;
}
