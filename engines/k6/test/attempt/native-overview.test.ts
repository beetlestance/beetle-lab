import { expect, it } from 'vitest';
import { nativeOverview } from '../../wrapper/attempt/native-overview.js';
import type { MetricEvidence, SummaryEvidence } from '../../wrapper/collection/types.js';

function metric(kind: MetricEvidence['kind'], values: MetricEvidence['values']): MetricEvidence {
  return {
    kind, values, nativeKey: 'synthetic', scope: 'execute',
    provenance: { source: 'native', counterRateDenominator: null, rateDenominator: null },
    missingStats: [], thresholds: [],
  };
}

it('retains recorded zeros and known tail percentiles without inventing unsampled rates or p95', () => {
  const summary: SummaryEvidence = {
    version: 2, timing: { testRunDurationMs: 10 }, nativeCollection: 'complete', rawBytes: 10, sha256: 'a'.repeat(64),
    metrics: {
      checks: metric('rate', { rate: 0, passes: 0, fails: 0 }),
      http_req_failed: metric('rate', { rate: 1, passes: 1 }),
      http_req_duration: metric('trend', { count: 1, 'p(50)': 0, 'p(99)': 3 }),
      dropped_iterations: metric('counter', { count: 0 }),
    },
  };
  expect(nativeOverview(summary)).toMatchObject({
    requests: null, failureRatio: null, checkPassRatio: null, droppedIterations: 0,
    p50Ms: 0, p95Ms: null, p99Ms: 3,
  });
});
