import { expect, it } from 'vitest';
import { DurationHistogram } from '@beetle/contracts/metrics';
import type { SeriesTotal } from '@beetle/contracts/metrics';
import type { ExecutionReceipt } from '../../wrapper/execution/index.js';
import { warningArtifact } from '../../wrapper/warnings/index.js';
import { compiled } from '../suite/fixtures.js';
const input = {suite: compiled(), attempt: {mode: 'managed' as const, timeoutMs: 10000, deadlineMs: 20000}};
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const scope = {organizationId: id, workspaceId: id, attemptId: id, generation: 1 as const};
function receipt(): ExecutionReceipt {
  const histogram = new DurationHistogram(); histogram.record(500); histogram.record(600);
  const total = {kind: 'trend' as const, count: 2, sum: 1100, min: 500, max: 600, mean: 550, distribution: histogram.snapshot()};
  return {ok: true, build: null, terminalObservedAt: '2026-01-01T00:00:00Z', summary: null, stream: null, metricFailure: null,
    process: {spawned: true, exitCode: 0, signal: null, cause: null, metricBytes: 1, diagnosticBytes: 1, collection: 'complete',
      state: 'stopped', stdioClosed: true, groupAbsent: true, quiescent: true,
      warnings: {coverage: 'complete', insufficientVus: 0, highCardinality: 0, maxDuration: 0, otherWarnings: 0, discardedSegments: 0}},
    metrics: {totals: [{metric: 'iteration_duration', kind: 'trend', scope: 'execute', tags: {phase: 'execute'}, total}],
      totalsComplete: true, measurement: {complete: true, sourceTimeMs: 0}, windowCoverage: {complete: true, latePoints: 0, markerDelayDroppedBuckets: 0}, quantiles: 'histogram-estimate'}};
}
it('identifies a complete global iteration distribution and preserves histogram bounds/count', () => {
  const report = warningArtifact(input, receipt(), scope)!;
  expect(report.iteration).toMatchObject({count: 2}); expect(report.iteration!.lower).toBeLessThanOrEqual(report.iteration!.estimate);
  expect(report.iteration!.upper).toBeGreaterThanOrEqual(report.iteration!.estimate); expect(report.configuration.arrival).toBeNull();
});
it('never substitutes request latency, phase/tag subsets, ambiguous or partial evidence', () => {
  const r = receipt(); const row = r.metrics!.totals[0]!;
  const cases: readonly SeriesTotal[][] = [[{...row, metric: 'http_req_duration'}], [row, row], [{...row, tags: {phase: 'execute', request: 'get'}}], [{...row, scope: 'prepare'}]];
  for (const totals of cases) expect(warningArtifact(input, {...r, metrics: {...r.metrics!, totals}}, scope)!.iteration).toBeNull();
  const interrupted = {...r, process: {...r.process!, cause: 'cancelled' as const, collection: 'partial' as const}};
  const report = warningArtifact(input, interrupted, scope)!; expect(report.native.coverage).toBe('partial'); expect(report.iteration).toBeNull();
  expect(warningArtifact(input, {...r, process: {...r.process!, stdioClosed: false}}, scope)).toBeNull();
  const {warnings, ...withoutWarnings} = r.process!; expect(warnings).toBeDefined();
  expect(warningArtifact(input, {...r, process: withoutWarnings}, scope)).toBeNull();
});
