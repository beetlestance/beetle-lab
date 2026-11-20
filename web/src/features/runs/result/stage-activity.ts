import type { RunChartHistory, RunMetricOverview } from '@beetle/contracts/api';
import type { PlanStage } from '../live/plan.js';
import type { StageScheduleRow } from '../timeline/StageSchedule.js';
import { sameChartSource } from './chart-model.js';

function matchingHistory(overview: RunMetricOverview, history: RunChartHistory): boolean {
  return (
    history.reason === null &&
    overview.id.toLowerCase() === history.id.toLowerCase() &&
    overview.attemptId.toLowerCase() === history.attemptId.toLowerCase() &&
    overview.scope.organizationId.toLowerCase() === history.scope.organizationId.toLowerCase() &&
    overview.scope.workspaceId.toLowerCase() === history.scope.workspaceId.toLowerCase() &&
    sameChartSource(overview, history)
  );
}

/** Join a retained native bucket only when it fits entirely inside a saved stage. */
export function stagesWithActivity(
  stages: readonly PlanStage[],
  overview: RunMetricOverview | null,
  history: RunChartHistory | null,
): readonly StageScheduleRow[] {
  const first = stages[0];
  const origin = overview?.scenarioStartedAtMs;
  if (!first || !overview || origin === undefined || !history || !matchingHistory(overview, history)) return stages;
  const windows = history.points.filter(
    (point) => point.endTimeMs - point.startTimeMs === 1000 && (point.httpSamples ?? 0) > 0,
  );
  let nextWindow = 0;
  return stages.map((stage) => {
    if (stage.drain) return stage;
    const start = stage.startMs - first.startMs;
    const end = start + stage.durationMs;
    while (nextWindow < windows.length && windows[nextWindow]!.startTimeMs - origin < start) nextWindow++;
    const observed = windows[nextWindow];
    if (!observed || observed.endTimeMs - origin > end) return stage;
    return { ...stage, observation: { fromMs: observed.startTimeMs - origin, toMs: observed.endTimeMs - origin } };
  });
}
