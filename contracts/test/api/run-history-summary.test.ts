import { expect, it } from 'vitest';
import { pendingRunHistorySummary, runHistorySummaryMatches } from '../../src/api/index.js';
import type { Run, RunHistorySummary } from '../../src/api/index.js';
import { fixture } from './fixtures.js';
async function measured() {
  const run = await fixture('valid/run.json') as Run;
  const summary: RunHistorySummary = { ...pendingRunHistorySummary(run), availability: 'ready',
    source: { generation: 1, manifestDigest: 'a'.repeat(64), numericArtifactId: run.activeAttemptId, numericSha256: 'b'.repeat(64), numericVersion: 4,
      measurementSourceTimeMs: 1000, coverage: { complete: true, latePoints: 0, markerDelayDroppedBuckets: 0 } },
    testDurationMs: 2000, requestCount: 8, requestsPerSecond: 4 };
  return { run, summary };
}
it('binds pending and measured summaries to exact run/attempt without inventing missing facts', async () => {
  const { run, summary } = await measured(); expect(runHistorySummaryMatches(summary, run)).toBe(true);
  expect(runHistorySummaryMatches(pendingRunHistorySummary(run), run)).toBe(true);
  expect(runHistorySummaryMatches({ ...summary, attemptId: run.id }, run)).toBe(false);
  expect(runHistorySummaryMatches({ ...summary, runId: run.activeAttemptId }, run)).toBe(false);
  expect(runHistorySummaryMatches({ ...pendingRunHistorySummary(run), requestCount: 0 }, run)).toBe(false);
});
it('checks observed rate even when no HTTP failure metric exists, and preserves v3/zero denominator unknown', async () => {
  const { run, summary } = await measured(); expect(runHistorySummaryMatches({ ...summary, requestsPerSecond: 9 }, run)).toBe(false);
  expect(runHistorySummaryMatches({ ...summary, testDurationMs: 0, requestsPerSecond: null }, run)).toBe(true);
  expect(runHistorySummaryMatches({ ...summary, testDurationMs: 0, requestsPerSecond: 0 }, run)).toBe(false);
  expect(runHistorySummaryMatches({ ...summary, source: { ...summary.source!, numericVersion: 3 } }, run)).toBe(false);
  expect(runHistorySummaryMatches({ ...summary, source: { ...summary.source!, numericVersion: 3 }, testDurationMs: null, requestsPerSecond: null }, run)).toBe(true);
});
it('rejects incoherent failure samples, quantile bounds, coverage and unknown fields', async () => {
  const { run, summary } = await measured();
  for (const changed of [{ httpFailures: 1 }, { httpFailures: 2, httpSamples: 1, httpFailureRatio: 1 },
    { httpFailures: 1, httpSamples: 2, httpFailureRatio: 0.4 },
    { httpP95: { source: 'histogram-estimate', scale: 4, lower: 2, estimate: 1, upper: 3 } },
    { source: { ...summary.source!, coverage: { complete: true, latePoints: 1, markerDelayDroppedBuckets: 0 } } },
    { extra: true }]) {
    expect(runHistorySummaryMatches({ ...summary, ...changed } as RunHistorySummary, run)).toBe(false);
  }
});
