import { liveMetricScopeMatches } from '@beetle/contracts/api';
import type { LiveMetricSnapshot, LiveTargetArchivePrefix, LiveMetricHistory } from '@beetle/contracts/api';
export interface Latest {
  readonly frame: LiveMetricSnapshot;
  readonly receivedWall: number;
  readonly targetPrefix?: LiveTargetArchivePrefix;
}
function detached(prefix: LiveTargetArchivePrefix): LiveTargetArchivePrefix {
  return Object.freeze({
    ...prefix,
    scope: Object.freeze({ ...prefix.scope }),
    data: Object.freeze({ ...prefix.data }),
  });
}
/** Keep a private target identity across optional-hint omissions, never across producer owners. */
export function currentFrame(frame: LiveMetricSnapshot, receivedWall: number, prior: Latest | null) {
  const changed =
    !!prior &&
    (!liveMetricScopeMatches(prior.frame.scope, frame.scope) ||
      prior.frame.producerEpoch !== frame.producerEpoch ||
      prior.frame.subsetDigest !== frame.subsetDigest);
  const target = frame.archivePrefix?.target ?? (changed ? undefined : prior?.targetPrefix);
  const latest: Latest = { frame, receivedWall, ...(target ? { targetPrefix: detached(target) } : {}) };
  return { changed, latest };
}
export function rememberTarget(latest: Latest, prefix: LiveTargetArchivePrefix | undefined): Latest {
  if (!prefix || (latest.targetPrefix && latest.targetPrefix.samples > prefix.samples)) return latest;
  return { ...latest, targetPrefix: detached(prefix) };
}
/** An older response may overlap a newer feed prefix; neither can change the archive's identity. */
export function targetPrefixMatches(actual: LiveTargetArchivePrefix, expected: LiveTargetArchivePrefix): boolean {
  if (
    !liveMetricScopeMatches(actual.scope, expected.scope) ||
    actual.intervalMs !== expected.intervalMs ||
    actual.data.artifactId.toLowerCase() !== expected.data.artifactId.toLowerCase()
  )
    return false;
  if (actual.samples === expected.samples)
    return actual.data.bytes === expected.data.bytes && actual.data.sha256 === expected.data.sha256;
  return actual.samples < expected.samples
    ? actual.data.bytes < expected.data.bytes
    : actual.data.bytes > expected.data.bytes;
}

export function targetHistoryMatches(
  value: LiveMetricHistory,
  expected: LiveTargetArchivePrefix | undefined,
  intervalMs?: number,
): boolean {
  if (value.targetSamples?.some((sample) => !Number.isFinite(Date.parse(sample.observedAt)))) return false;
  const target = value.prefix.target;
  if (target && intervalMs !== undefined && target.intervalMs !== intervalMs) return false;
  return !target || !expected || targetPrefixMatches(target, expected);
}
