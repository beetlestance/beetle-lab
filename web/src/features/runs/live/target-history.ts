import { targetMetricNames } from '@beetle/contracts/target-runtime';
import type { TargetMetricName, TargetRuntimeSample } from '@beetle/contracts/target-runtime';
import type { LiveMetricSnapshot, LiveMetricHistory, LiveTargetArchivePrefix } from '@beetle/contracts/api';

export interface TargetPoint {
  readonly t: number;
  readonly observedAtMs: number;
  readonly archiveSequence: number | null;
  readonly phase: TargetRuntimeSample['phase'];
  readonly gapBefore: boolean;
  readonly status: TargetRuntimeSample['status'];
  readonly reason: TargetRuntimeSample['reason'];
  readonly values: TargetRuntimeSample['values'];
}
export interface TargetCoverage {
  readonly samples: number;
  readonly dataArtifactId: string;
}
export interface TargetHistory {
  readonly target: readonly TargetPoint[];
  readonly targetCoverage: TargetCoverage | null;
  readonly targetLimited: boolean;
  readonly intervalMs: number | null;
}
export function targetFrame(previous: TargetHistory, frame: LiveMetricSnapshot, originMs: number): TargetHistory {
  return {
    target: mergeTargets(previous.target, freshTarget(previous.target, frame, originMs)),
    targetCoverage: previous.targetCoverage,
    targetLimited: previous.targetLimited || frame.archivePrefix?.target?.samples === 256,
    intervalMs: frame.target?.intervalMs ?? previous.intervalMs,
  };
}
function values(input: Partial<Record<TargetMetricName, number | null>>): TargetRuntimeSample['values'] {
  // The shared schema owns this key list. A key absent from the live subset stays unknown.
  return Object.freeze(
    Object.fromEntries(targetMetricNames.map((name) => [name, input[name] ?? null])),
  ) as TargetRuntimeSample['values'];
}
export function freshTarget(
  existing: readonly TargetPoint[],
  frame: LiveMetricSnapshot,
  originMs: number,
): TargetPoint[] {
  const block = frame.target;
  if (!block) return [];
  const seen = new Set(existing.map((point) => `${point.observedAtMs}:${point.phase}`));
  return block.samples
    .filter((sample) => !seen.has(`${sample.observedAtMs}:${sample.phase}`))
    .map((sample, index) => ({
      t: sample.observedAtMs - originMs,
      observedAtMs: sample.observedAtMs,
      archiveSequence: null,
      phase: sample.phase,
      gapBefore: index === 0 && block.omittedSamples > 0 && existing.length > 0,
      status: sample.status,
      reason: null,
      values: values(sample.values),
    }));
}
/** Archive ordinals retain distinct observations even when source UTC timestamps repeat. */
export function mergeTargets(existing: readonly TargetPoint[], incoming: readonly TargetPoint[]): TargetPoint[] {
  const recorded = new Map<number, TargetPoint>();
  for (const point of [...existing, ...incoming])
    if (point.archiveSequence !== null && !recorded.has(point.archiveSequence))
      recorded.set(point.archiveSequence, point);
  const archived = [...recorded.values()].sort((a, b) => a.archiveSequence! - b.archiveSequence!);
  const known = new Set(archived.map((point) => `${point.observedAtMs}:${point.phase}`));
  const live = new Map<string, TargetPoint>();
  for (const point of [...existing, ...incoming]) {
    const key = `${point.observedAtMs}:${point.phase}`;
    if (point.archiveSequence === null && !known.has(key)) live.set(key, point);
  }
  const room = Math.max(0, 256 - archived.length);
  const later = [...live.values()].sort((a, b) => a.observedAtMs - b.observedAtMs);
  const sorted = [...archived, ...(room ? later.slice(-room) : [])].sort((a, b) => a.observedAtMs - b.observedAtMs);
  return sorted.map((point, index) => ({
    ...point,
    gapBefore: point.gapBefore || sourceGap(point, sorted[index - 1]),
  }));
}
export function recordedTargets(history: LiveMetricHistory, originMs: number): TargetPoint[] {
  return (history.targetSamples ?? []).map((sample, index) => {
    const observedAtMs = Date.parse(sample.observedAt);
    return {
      t: observedAtMs - originMs,
      observedAtMs,
      archiveSequence: index + 1,
      phase: sample.phase,
      gapBefore: false,
      status: sample.status,
      reason: sample.reason,
      values: values(sample.values),
    };
  });
}
export function targetCoverage(
  prefix: LiveTargetArchivePrefix | undefined,
  previous: TargetCoverage | null,
): TargetCoverage | null {
  if (!prefix || (previous && previous.samples > prefix.samples)) return previous;
  return { samples: prefix.samples, dataArtifactId: prefix.data.artifactId };
}

function sourceGap(point: TargetPoint, previous: TargetPoint | undefined): boolean {
  if (!previous) return false;
  return (
    point.observedAtMs <= previous.observedAtMs ||
    (point.archiveSequence !== null &&
      previous.archiveSequence !== null &&
      point.archiveSequence !== previous.archiveSequence + 1)
  );
}
