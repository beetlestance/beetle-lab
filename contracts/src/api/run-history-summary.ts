import { encodeJson } from '../json.js';
import { validateApi } from './validate.js';
import type { Run, RunHistorySummary } from './generated/types.js';

export type RunHistoryMetrics = Omit<RunHistorySummary, 'runId' | 'attemptId' | 'retainedLogicalBytes' | 'metadataAllowanceBytes'>;
export function pendingRunHistoryMetrics(): RunHistoryMetrics {
  return { availability: 'pending', source: null, testDurationMs: null, requestCount: null,
    requestsPerSecond: null, httpFailures: null, httpSamples: null, httpFailureRatio: null,
    httpP95: null, publishedArtifactBytes: null };
}
export function pendingRunHistorySummary(run: Pick<Run, 'id' | 'activeAttemptId'>): RunHistorySummary {
  return { ...pendingRunHistoryMetrics(), runId: run.id.toLowerCase(), attemptId: run.activeAttemptId.toLowerCase(),
    retainedLogicalBytes: null, metadataAllowanceBytes: null };
}
function numericFacts(value: RunHistorySummary): boolean {
  const fields = [value.testDurationMs, value.requestCount, value.requestsPerSecond, value.httpFailures,
    value.httpSamples, value.httpFailureRatio, value.httpP95, value.source];
  if (value.availability !== 'ready') return fields.every(field => field === null);
  if (value.source === null) return false;
  if (value.source.numericVersion === 3 && (value.testDurationMs !== null || value.requestsPerSecond !== null)) return false;
  if (value.source.coverage.complete !== (value.source.coverage.latePoints === 0 && value.source.coverage.markerDelayDroppedBuckets === 0)) return false;
  return rateFacts(value) && percentileFacts(value);
}
function rateFacts(value: RunHistorySummary): boolean {
  const rate = value.testDurationMs && value.requestCount !== null ? value.requestCount / (value.testDurationMs / 1000) : null;
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
    return validateApi('RunHistorySummary', value).ok && value.runId === run.id.toLowerCase()
      && value.attemptId === run.activeAttemptId.toLowerCase() && numericFacts(value);
  } catch { return false; }
}
