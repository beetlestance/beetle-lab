import { encodeJson, jsonNodeCount } from '../json.js';
import type { RunChartHistory, RunChartPoint, WorkspaceScope } from './generated/types.js';
type Key = { id: string; scope: WorkspaceScope; attemptId: string };
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
/** Actual source ordinals, evenly selected, with both endpoints preserved. */
export function chartSampleOrdinals(windows: number): number[] {
  if (!Number.isSafeInteger(windows) || windows < 0 || windows > 65536) throw Error('Invalid history size');
  const count = Math.min(900, windows);
  if (count <= 1) return count ? [1] : [];
  return Array.from({ length: count }, (_, i) => 1 + Math.floor((i * (windows - 1)) / (count - 1)));
}
/** Arithmetic mean of bounded recorded nonnegative values; never invent a zero on underflow. */
export function recordedValueMean(values: readonly number[]): number | null {
  if (!values.length) return null;
  let result = 0;
  for (const [index, value] of values.entries()) {
    if (!Number.isFinite(value) || value < 0 || Object.is(value, -0)) return null;
    const difference = value - result;
    const step = difference / (index + 1);
    if (difference !== 0 && step === 0) return null;
    result += step;
  }
  return Number.isFinite(result) ? result : null;
}
function vusMeanMatches(value: RunChartHistory): boolean {
  if (value.knownVusWindows > value.windows) return false;
  const known = value.points.filter((point) => point.vus !== null);
  if (
    known.length > value.knownVusWindows ||
    value.points.length - known.length > value.windows - value.knownVusWindows
  )
    return false;
  const eligible = vusMeanEligible(value);
  if (!eligible) return value.meanVus === null;
  return value.sampled || value.meanVus === recordedValueMean(known.map((point) => point.vus!));
}
function vusMeanEligible(value: RunChartHistory): boolean {
  const first = value.points[0],
    last = value.points.at(-1);
  return (
    value.source?.coverage.complete === true &&
    value.knownVusWindows === value.windows &&
    !!first &&
    !!last &&
    last.endTimeMs - first.startTimeMs === value.windows * 1000
  );
}
function pointValues(point: RunChartPoint): boolean {
  if (point.endTimeMs - point.startTimeMs !== 1000) return false;
  if (point.httpFailures === null || point.httpSamples === null) {
    if (point.httpFailures !== null || point.httpSamples !== null) return false;
  } else if (point.httpFailures > point.httpSamples) return false;
  const estimates = [point.httpP50, point.httpP95, point.httpP99];
  if (estimates.some((p) => p === null)) return estimates.every((p) => p === null);
  return (
    estimates.every((p) => p!.lower <= p!.estimate && p!.estimate <= p!.upper) &&
    estimates.every((p, i) => i === 0 || p!.estimate >= estimates[i - 1]!.estimate)
  );
}
function pointsMatch(value: RunChartHistory): boolean {
  const ordinals = chartSampleOrdinals(value.windows);
  if (value.points.length !== ordinals.length || value.sampled !== value.windows > 900) return false;
  let previous: RunChartPoint | undefined;
  for (let index = 0; index < value.points.length; index++) {
    const point = value.points[index]!;
    if (point.sequence !== ordinals[index] || !pointValues(point)) return false;
    const gap = previous
      ? point.startTimeMs - previous.endTimeMs !== (point.sequence - previous.sequence - 1) * 1000
      : false;
    if (point.gapBefore !== gap || (previous && point.startTimeMs < previous.endTimeMs)) return false;
    previous = point;
  }
  return peakMatches(value);
}
function peakMatches(value: RunChartHistory): boolean {
  if (value.knownRequestWindows > value.windows) return false;
  if ((value.knownRequestWindows === 0) !== (value.observedPeakRequestsPerSecond === null)) return false;
  const known = value.points.filter((p) => p.requestCount !== null);
  if (
    known.length > value.knownRequestWindows ||
    value.points.length - known.length > value.windows - value.knownRequestWindows
  )
    return false;
  const maximum = known.length ? Math.max(...known.map((point) => point.requestCount!)) : null;
  if (known.length === value.knownRequestWindows) return value.observedPeakRequestsPerSecond === maximum;
  return known.every(
    (p) => value.observedPeakRequestsPerSecond !== null && p.requestCount! <= value.observedPeakRequestsPerSecond,
  );
}
function contents(value: RunChartHistory): boolean {
  if (value.reason !== null) return unavailableMatches(value);
  const source = value.source;
  if (!source || value.windows > 3600) return false;
  if (
    source.coverage.complete !== (source.coverage.latePoints === 0 && source.coverage.markerDelayDroppedBuckets === 0)
  )
    return false;
  return pointsMatch(value) && vusMeanMatches(value);
}
/** Schema validation precedes this ownership, source, sampling and reply-budget check. */
export function runChartHistoryMatches(value: RunChartHistory, key: Key): boolean {
  try {
    encodeJson(value, 1048576);
    jsonNodeCount(value);
    return (
      same(value.id, key.id) &&
      same(value.attemptId, key.attemptId) &&
      same(value.scope.organizationId, key.scope.organizationId) &&
      same(value.scope.workspaceId, key.scope.workspaceId) &&
      contents(value)
    );
  } catch {
    return false;
  }
}

function unavailableMatches(value: RunChartHistory): boolean {
  if (
    value.points.length ||
    value.sampled ||
    value.knownRequestWindows ||
    value.observedPeakRequestsPerSecond !== null ||
    value.knownVusWindows !== 0 ||
    value.meanVus !== null
  )
    return false;
  return value.reason === 'too_large' ? value.source !== null : value.source === null && value.windows === 0;
}
