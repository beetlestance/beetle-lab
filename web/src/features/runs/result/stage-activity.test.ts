import { expect, it } from 'vitest';
import type { RunChartHistory, RunMetricOverview } from '@beetle/contracts/api';
import type { PlanStage } from '../live/plan.js';
import historyFixture from '../../../../../contracts/fixtures/api/valid/run-chart-history.json' with { type: 'json' };
import overviewFixture from '../../../../../contracts/fixtures/api/valid/run-metric-overview.json' with { type: 'json' };
import { stagesWithActivity } from './stage-activity.js';

const stages: readonly PlanStage[] = [
  { label: 'Ramp', startMs: 5000, durationMs: 2500, drain: false },
  { label: 'Hold', startMs: 7500, durationMs: 2500, drain: false },
  { label: 'Ramp down', startMs: 10000, durationMs: 1000, drain: false },
  { label: 'Drain', startMs: 11000, durationMs: 1000, drain: true },
];
function source() {
  const chart = structuredClone(historyFixture) as RunChartHistory;
  const origin = chart.source!.measurementSourceTimeMs + 600;
  const overview: RunMetricOverview = {
    ...(overviewFixture as RunMetricOverview),
    id: chart.id,
    attemptId: chart.attemptId,
    scope: chart.scope,
    source: chart.source,
    scenarioStartedAtMs: origin,
  };
  const window = chart.points[0]!;
  chart.points = [
    [-400, 50],
    [1000, 3],
    [2000, 3],
    [3000, 0],
    [4000, 3],
    [6000, 3],
  ].map(([offset, samples], index) => ({
    ...window,
    sequence: index + 1,
    startTimeMs: origin + offset!,
    endTimeMs: origin + offset! + 1000,
    httpSamples: samples!,
  }));
  return { chart, overview };
}

it('shows positive retained windows fully contained in the correct stage and leaves missing and drain stages unchanged', () => {
  const { chart, overview } = source();
  const observed = stagesWithActivity(stages, overview, chart);
  expect(observed[0]).toMatchObject({ observation: { fromMs: 1000, toMs: 2000 } });
  expect(observed[1]).toMatchObject({ observation: { fromMs: 4000, toMs: 5000 } });
  expect(observed[2]).toBe(stages[2]);
  expect(observed[3]).toBe(stages[3]);
});

it('falls back to the schedule on absent or mismatched source evidence', () => {
  const { chart, overview } = source();
  expect(stagesWithActivity(stages, overview, null)).toBe(stages);
  expect(stagesWithActivity(stages, { ...overview, attemptId: 'other' }, chart)).toBe(stages);
  expect(
    stagesWithActivity(stages, { ...overview, source: { ...overview.source!, numericSha256: 'a'.repeat(64) } }, chart),
  ).toBe(stages);
});
