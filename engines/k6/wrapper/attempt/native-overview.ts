import type { EngineResult } from '@beetle/contracts';
import type { SummaryEvidence } from '../collection/index.js';

export function nativeOverview(summary: SummaryEvidence): NonNullable<EngineResult['nativeOverview']> {
  return {
    summarySha256: summary.sha256,
    durationMs: summary.timing.testRunDurationMs,
    requests: summary.metrics.http_reqs?.values.count ?? null,
    failureRatio: rate(summary.metrics.http_req_failed),
    checkPassRatio: rate(summary.metrics.checks),
    droppedIterations: summary.metrics.dropped_iterations?.values.count ?? null,
    ...latency(summary.metrics.http_req_duration?.values),
  };
}

function latency(values: SummaryEvidence['metrics'][string]['values'] | undefined) {
  if (!values?.count) return { p50Ms: null, p95Ms: null, p99Ms: null };
  return {
    p50Ms: values['p(50)'] ?? values.med ?? null,
    p95Ms: values['p(95)'] ?? null,
    p99Ms: values['p(99)'] ?? null,
  };
}

function rate(metric: SummaryEvidence['metrics'][string] | undefined): number | null {
  const values = metric?.values;
  const passes = values?.passes;
  const fails = values?.fails;
  if (passes === undefined || fails === undefined) return null;
  const samples = passes + fails;
  return Number.isSafeInteger(samples) && samples > 0 ? (values?.rate ?? null) : null;
}
