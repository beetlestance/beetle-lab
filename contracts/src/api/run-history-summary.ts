import { encodeJson } from '../json.js';
import { validateApi } from './validate.js';
import type { Run, RunHistorySummary } from './generated/types.js';

export type RunHistoryMetrics = Omit<
  RunHistorySummary,
  'runId' | 'attemptId' | 'retainedLogicalBytes' | 'metadataAllowanceBytes'
>;
export function pendingRunHistoryMetrics(): RunHistoryMetrics {
  return {
    availability: 'pending',
    source: null,
    testDurationMs: null,
    requestCount: null,
    requestsPerSecond: null,
    httpFailures: null,
    httpSamples: null,
    httpFailureRatio: null,
    httpP95: null,
    publishedArtifactBytes: null,
  };
}
export function pendingRunHistorySummary(run: Pick<Run, 'id' | 'activeAttemptId'>): RunHistorySummary {
  return {
    ...pendingRunHistoryMetrics(),
    runId: run.id.toLowerCase(),
    attemptId: run.activeAttemptId.toLowerCase(),
    retainedLogicalBytes: null,
    metadataAllowanceBytes: null,
  };
}
type HttpP95Preview = NonNullable<RunHistorySummary['httpP95Preview']>;
/** Capture the closed preview carried by numeric-final and the indexed summary. */
export function captureHttpP95Preview(input: unknown): HttpP95Preview {
  if (!Array.isArray(input) || input.length < 2 || input.length > 12) throw new Error('Invalid p95 preview length');
  let previous = -1;
  return Array.from(input, (value, index) => {
    const point = capturePreviewPoint(value);
    if (point.offsetSeconds <= previous || (index === 0 && point.gapBefore))
      throw new Error('Invalid p95 preview order');
    previous = point.offsetSeconds;
    return point;
  });
}

function capturePreviewPoint(input: unknown): HttpP95Preview[number] {
  const keys = ['offsetSeconds', 'p95Ms', 'gapBefore'];
  if (
    !input ||
    typeof input !== 'object' ||
    Reflect.ownKeys(input).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(input, key))
  )
    throw new Error('Invalid p95 preview point');
  const { offsetSeconds, p95Ms, gapBefore } = input as HttpP95Preview[number];
  if (
    !Number.isSafeInteger(offsetSeconds) ||
    offsetSeconds > 8640000000000 ||
    !Number.isFinite(p95Ms) ||
    p95Ms < 0 ||
    typeof gapBefore !== 'boolean'
  )
    throw new Error('Invalid p95 preview values');
  return { offsetSeconds, p95Ms, gapBefore };
}

function previewFacts(value: RunHistorySummary): boolean {
  if (value.httpP95Preview === undefined) return true;
  if (value.availability !== 'ready' || value.source?.numericVersion !== 5 || value.httpP95 === null) return false;
  captureHttpP95Preview(value.httpP95Preview);
  return true;
}

function numericFacts(value: RunHistorySummary): boolean {
  const fields = [
    value.testDurationMs,
    value.requestCount,
    value.requestsPerSecond,
    value.httpFailures,
    value.httpSamples,
    value.httpFailureRatio,
    value.httpP95,
    value.source,
  ];
  if (value.availability !== 'ready') return fields.every((field) => field === null);
  if (value.source === null) return false;
  if (value.source.numericVersion === 3 && (value.testDurationMs !== null || value.requestsPerSecond !== null))
    return false;
  if (
    value.source.coverage.complete !==
    (value.source.coverage.latePoints === 0 && value.source.coverage.markerDelayDroppedBuckets === 0)
  )
    return false;
  return rateFacts(value) && percentileFacts(value);
}
function rateFacts(value: RunHistorySummary): boolean {
  const rate =
    value.testDurationMs && value.requestCount !== null ? value.requestCount / (value.testDurationMs / 1000) : null;
  const expected = rate !== null && Number.isFinite(rate) ? rate : null;
  return value.requestsPerSecond === expected && failureFacts(value);
}
function failureFacts(value: RunHistorySummary): boolean {
  if (value.httpSamples === null || value.httpFailures === null) {
    return value.httpSamples === null && value.httpFailures === null && value.httpFailureRatio === null;
  }
  if (value.httpFailures > value.httpSamples) return false;
  return value.httpFailureRatio === (value.httpSamples ? value.httpFailures / value.httpSamples : null);
}
function percentileFacts(value: RunHistorySummary): boolean {
  const p = value.httpP95;
  return p === null || (p.lower <= p.estimate && p.estimate <= p.upper);
}
/** Closed schema, bytes, run/attempt and scalar coherence; no native read authority. */
export function runHistorySummaryMatches(value: RunHistorySummary, run: Pick<Run, 'id' | 'activeAttemptId'>): boolean {
  try {
    encodeJson(value, 2048);
    return (
      validateApi('RunHistorySummary', value).ok &&
      value.runId === run.id.toLowerCase() &&
      value.attemptId === run.activeAttemptId.toLowerCase() &&
      numericFacts(value) &&
      previewFacts(value)
    );
  } catch {
    return false;
  }
}
