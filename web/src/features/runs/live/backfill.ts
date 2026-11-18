import { liveMetricScopeMatches } from '@beetle/contracts/api';
import type { LiveMetricHistory, LiveMetricSnapshot, LiveTargetArchivePrefix } from '@beetle/contracts/api';
import { metricPoint, mergePoints } from './history.js';
import type { LiveHistory } from './history.js';
import { targetHistoryMatches } from './current.js';
import { mergeTargets, recordedTargets, targetCoverage } from './target-history.js';
import { liveFigures } from './model.js';
import type { RunPlan } from './plan.js';
/** Current verified lease authority, never merely the route or an archive's self-declaration. */
export function historyMatches(
  value: LiveMetricHistory,
  frame: LiveMetricSnapshot,
  target?: LiveTargetArchivePrefix,
): boolean {
  if (
    !liveMetricScopeMatches(value.scope, frame.scope) ||
    value.producerEpoch !== frame.producerEpoch ||
    value.subsetDigest !== frame.subsetDigest ||
    !targetHistoryMatches(value, target ?? frame.archivePrefix?.target, frame.target?.intervalMs)
  )
    return false;
  const prefix = frame.archivePrefix;
  return (
    !prefix ||
    (prefix.data.artifactId.toLowerCase() === value.prefix.data.artifactId.toLowerCase() &&
      prefix.index.artifactId.toLowerCase() === value.prefix.index.artifactId.toLowerCase())
  );
}
export function mergeHistory(
  history: LiveHistory,
  value: LiveMetricHistory,
  plan: RunPlan,
  startedAt: string | null | undefined,
): LiveHistory {
  const start = startedAt ? Date.parse(startedAt) : NaN;
  const originMs = Number.isFinite(start) ? start : value.samples[0]!.startTimeMs;
  const existing = history.points.map((point) => ({ ...point, t: point.t + history.originMs - originMs }));
  const points = value.samples.map((sample) => {
    const window = { ...sample, subset: value.subset };
    return metricPoint(window, liveFigures(window, plan), originMs, sample.sequence);
  });
  return {
    ...history,
    originMs,
    fromStart: Number.isFinite(start),
    points: mergePoints(existing, points),
    target: mergeTargets(
      history.target.map((point) => ({ ...point, t: point.observedAtMs - originMs })),
      recordedTargets(value, originMs),
    ),
    targetCoverage: targetCoverage(value.prefix.target, history.targetCoverage),
    targetLimited: history.targetLimited || value.prefix.target?.samples === 256,
    intervalMs: value.prefix.target?.intervalMs ?? history.intervalMs,
    coverage: {
      throughTimeMs: value.prefix.endTimeMs,
      windows: value.prefix.windows,
      producerEpoch: value.producerEpoch,
      subsetDigest: value.subsetDigest,
      dataArtifactId: value.prefix.data.artifactId,
      indexArtifactId: value.prefix.index.artifactId,
    },
  };
}
export function recordedCount(history: LiveHistory): number {
  const limit = history.coverage?.windows ?? 0;
  return new Set(
    history.points
      .map((point) => point.archiveSequence)
      .filter((value): value is number => value !== null && value <= limit),
  ).size;
}
