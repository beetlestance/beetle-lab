import type { LiveMetricSnapshot } from '@beetle/contracts/api';
import { targetFrame } from './target-history.js';
import type { TargetHistory } from './target-history.js';
export type { TargetPoint } from './target-history.js';
import type { LiveFigures, MetricWindowView } from './model.js';

/**
 * Bounded actual live and recorded source windows, never interpolated values.
 * Source sequence domains stay distinct from live publication counters. Target
 * samples combine actual archive observations and live readings. Archive ordinals
 * remain distinct even when UTC timestamps repeat; omitted live readings break lines.
 */
export const HISTORY_LIMIT = 900;

export interface LivePoint {
  /** Window end, in ms since the run origin. */
  readonly t: number;
  readonly archiveSequence: number | null;
  readonly feedSourceSequence: number | null;
  /** Missing source time before this received window; never connect across it. */
  readonly gapBefore: boolean;
  readonly rps: number | null;
  readonly p50: number | null;
  readonly p95: number | null;
  readonly p99: number | null;
  readonly failedPerSecond: number | null;
  readonly vus: number | null;
  readonly vusMax: number | null;
}
export interface HistoryCoverage {
  readonly throughTimeMs: number;
  readonly windows: number;
  readonly producerEpoch: string;
  readonly subsetDigest: string;
  readonly dataArtifactId: string;
  readonly indexArtifactId: string;
}
export interface LiveHistory extends TargetHistory {
  readonly lastPublishedSequence: number;
  readonly liveSampled: boolean;
  readonly coverage: HistoryCoverage | null;
  readonly points: readonly LivePoint[];
  /** Wall time (ms) of the run origin used for `t`. */
  readonly originMs: number;
  /** True when the origin is the run's start; false when it is the first window this page saw. */
  readonly fromStart: boolean;
}

export function emptyHistory(startedAt: string | null | undefined): LiveHistory {
  const start = startedAt ? Date.parse(startedAt) : Number.NaN;
  return {
    points: [],
    lastPublishedSequence: 0,
    liveSampled: false,
    coverage: null,
    target: [],
    targetCoverage: null,
    targetLimited: false,
    originMs: Number.isFinite(start) ? start : Number.NaN,
    fromStart: Number.isFinite(start),
    intervalMs: null,
  };
}

export function metricPoint(
  frame: MetricWindowView,
  figures: LiveFigures,
  originMs: number,
  archiveSequence: number | null,
  gapBefore = false,
): LivePoint {
  return {
    t: frame.endTimeMs - originMs,
    archiveSequence,
    feedSourceSequence: null,
    gapBefore,
    rps: figures.rps,
    p50: figures.p50?.value ?? null,
    p95: figures.p95?.value ?? null,
    p99: figures.p99?.value ?? null,
    failedPerSecond: figures.failedPerSecond,
    vus: figures.vus,
    vusMax: figures.vusMax,
  };
}

export function appendFrame(history: LiveHistory, frame: LiveMetricSnapshot, figures: LiveFigures): LiveHistory {
  if (frame.publishedSequence <= history.lastPublishedSequence) return history;
  const originMs = Number.isFinite(history.originMs) ? history.originMs : frame.startTimeMs;
  const archiveSequence = frame.archivePrefix?.endTimeMs === frame.endTimeMs ? frame.archivePrefix.windows : null;
  const point = { ...metricPoint(frame, figures, originMs, archiveSequence), feedSourceSequence: frame.sourceSequence };
  return {
    ...history,
    lastPublishedSequence: frame.publishedSequence,
    liveSampled:
      history.liveSampled ||
      frame.coalescedWindows > 0 ||
      frame.publishedSequence - history.lastPublishedSequence > 1 ||
      history.points.length >= HISTORY_LIMIT,
    points: mergePoints(history.points, [point]),
    ...targetFrame(history, frame, originMs),
    originMs,
    fromStart: history.fromStart,
  };
}
/** Deduplicate actual windows; any chart reduction preserves the first and final point. */
export function mergePoints(existing: readonly LivePoint[], incoming: readonly LivePoint[]): LivePoint[] {
  const byTime = new Map(existing.map((point) => [point.t, point]));
  for (const point of incoming) {
    const previous = byTime.get(point.t);
    const value =
      previous?.archiveSequence !== null && previous?.archiveSequence !== undefined && point.archiveSequence === null
        ? previous
        : point;
    byTime.set(point.t, {
      ...value,
      feedSourceSequence: point.feedSourceSequence ?? previous?.feedSourceSequence ?? null,
    });
  }
  const sorted = [...byTime.values()].sort((a, b) => a.t - b.t);
  const size = Math.min(HISTORY_LIMIT, sorted.length);
  const points = Array.from(
    { length: size },
    (_, index) => sorted[size === 1 ? 0 : Math.floor((index * (sorted.length - 1)) / (size - 1))]!,
  );
  return points.map((point, index) => ({ ...point, gapBefore: sourceGap(point, points[index - 1]) }));
}
function sourceGap(point: LivePoint, previous: LivePoint | undefined): boolean {
  if (!previous) return false;
  let delta = 1;
  if (point.archiveSequence !== null && previous.archiveSequence !== null)
    delta = point.archiveSequence - previous.archiveSequence;
  else if (point.feedSourceSequence !== null && previous.feedSourceSequence !== null)
    delta = point.feedSourceSequence - previous.feedSourceSequence;
  return delta <= 0 || point.t - previous.t > delta * 1000;
}
