import type { LiveMetricSnapshot, LiveTargetSample } from '@beetle/contracts/api';
import type { LiveFigures } from './model.js';

/**
 * A bounded record of the live windows this browser received while the page was
 * open. Points are API values from those windows (no backfill, no interpolation);
 * charts start where the page started reading. Target samples are de-duplicated by
 * observation time, and a frame that reports omitted samples breaks the line.
 */
export const HISTORY_LIMIT = 900;

export interface LivePoint {
  /** Window end, in ms since the run origin. */
  readonly t: number;
  readonly sequence: number;
  readonly rps: number | null;
  readonly p50: number | null;
  readonly p95: number | null;
  readonly p99: number | null;
  readonly failedPerSecond: number | null;
  readonly vus: number | null;
  readonly vusMax: number | null;
}
export interface TargetPoint {
  readonly t: number;
  readonly observedAtMs: number;
  readonly gapBefore: boolean;
  readonly status: LiveTargetSample['status'];
  readonly values: LiveTargetSample['values'];
}
export interface LiveHistory {
  readonly points: readonly LivePoint[];
  readonly target: readonly TargetPoint[];
  /** Wall time (ms) of the run origin used for `t`. */
  readonly originMs: number;
  /** True when the origin is the run's start; false when it is the first window this page saw. */
  readonly fromStart: boolean;
  readonly intervalMs: number | null;
}

export function emptyHistory(startedAt: string | null | undefined): LiveHistory {
  const start = startedAt ? Date.parse(startedAt) : Number.NaN;
  return {
    points: [],
    target: [],
    originMs: Number.isFinite(start) ? start : Number.NaN,
    fromStart: Number.isFinite(start),
    intervalMs: null,
  };
}

const cap = <T>(items: T[]) => (items.length > HISTORY_LIMIT ? items.slice(items.length - HISTORY_LIMIT) : items);

export function appendFrame(history: LiveHistory, frame: LiveMetricSnapshot, figures: LiveFigures): LiveHistory {
  const last = history.points.at(-1);
  if (last && frame.publishedSequence <= last.sequence) return history;
  const originMs = Number.isFinite(history.originMs) ? history.originMs : frame.startTimeMs;
  const point: LivePoint = {
    t: frame.endTimeMs - originMs,
    sequence: frame.publishedSequence,
    rps: figures.rps,
    p50: figures.p50?.value ?? null,
    p95: figures.p95?.value ?? null,
    p99: figures.p99?.value ?? null,
    failedPerSecond: figures.failedPerSecond,
    vus: figures.vus,
    vusMax: figures.vusMax,
  };
  const seen = history.target.at(-1)?.observedAtMs ?? -1;
  const fresh = (frame.target?.samples ?? []).filter((s) => s.observedAtMs > seen);
  const omitted = (frame.target?.omittedSamples ?? 0) > 0;
  const target = fresh.map((sample, index) => ({
    t: sample.observedAtMs - originMs,
    observedAtMs: sample.observedAtMs,
    gapBefore: index === 0 && omitted && history.target.length > 0,
    status: sample.status,
    values: sample.values,
  }));
  return {
    points: cap([...history.points, point]),
    target: cap([...history.target, ...target]),
    originMs,
    fromStart: history.fromStart,
    intervalMs: frame.target?.intervalMs ?? history.intervalMs,
  };
}
