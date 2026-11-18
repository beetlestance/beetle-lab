import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { captureMailboxImage, MAILBOX_PAYLOAD_BYTES } from '@beetle/contracts/live-mailbox';
import {
  captureLiveMetricSnapshot,
  decodeLiveMetricSnapshot,
  liveMetricScopeMatches,
  liveMetricSubsetText,
} from '@beetle/contracts/api';
import type { LiveMetricSnapshot, LiveMetricArchivePrefix, LiveTargetArchivePrefix } from '@beetle/contracts/api';
import type { LiveMetricApproval, LiveMetricReadFailure } from './types.js';
export const hash = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
export interface Position {
  readonly revision: number;
  readonly source: number;
  readonly start: number;
  readonly end: number;
  readonly captured: number;
  readonly published: number;
  readonly coalesced: number;
  readonly digest: string;
  readonly archivePrefix?: LiveMetricArchivePrefix;
}
export function approvalSnapshot(input: LiveMetricApproval) {
  const subsetDigest = hash(liveMetricSubsetText(input.subset));
  const frame = captureLiveMetricSnapshot(
    {
      version: 1,
      scope: input.scope,
      producerEpoch: input.producerEpoch,
      subset: input.subset,
      subsetDigest,
      sourceSequence: 1,
      publishedSequence: 1,
      coalescedWindows: 0,
      capturedAtMs: 0,
      publishedAtMs: 0,
      startTimeMs: 0,
      endTimeMs: 1000,
      upstreamCoverage: 'unknown',
      series: [],
    },
    hash,
  );
  return {
    scope: frame.scope,
    producerEpoch: frame.producerEpoch,
    subsetDigest,
    targetIntervalMs: input.targetIntervalMs ?? null,
  };
}
export function frameSnapshot(image: Uint8Array) {
  const envelope = captureMailboxImage(image, hash);
  const frame = decodeLiveMetricSnapshot(gunzipSync(envelope.frame, { maxOutputLength: MAILBOX_PAYLOAD_BYTES }), hash);
  if (frame.publishedSequence !== envelope.revision) throw new Error('ordering');
  return {
    frame,
    position: {
      revision: envelope.revision,
      source: frame.sourceSequence,
      start: frame.startTimeMs,
      end: frame.endTimeMs,
      captured: frame.capturedAtMs,
      published: frame.publishedAtMs,
      coalesced: frame.coalescedWindows,
      digest: hash(envelope.frame),
      ...(frame.archivePrefix ? { archivePrefix: prefixPosition(frame.archivePrefix) } : {}),
    },
  };
}
export function frameRejection(input: {
  frame: LiveMetricSnapshot;
  position: Position;
  previous: Position | undefined;
  approval: ReturnType<typeof approvalSnapshot>;
  wall: number;
}): LiveMetricReadFailure | undefined {
  const { frame, position, previous, approval, wall } = input;
  if (!liveMetricScopeMatches(frame.scope, approval.scope)) return 'scope';
  if (frame.producerEpoch !== approval.producerEpoch) return 'epoch';
  if (frame.subsetDigest !== approval.subsetDigest) return 'subset';
  if (!targetIntervalMatches(frame, approval.targetIntervalMs)) return 'target';
  if (wall < Math.max(frame.publishedAtMs, frame.capturedAtMs, frame.endTimeMs) || wall - sourceTime(frame) > 6000)
    return 'stale';
  if (previous && ordering(position, previous)) return 'ordering';
  return undefined;
}
function ordering(next: Position, previous: Position): boolean {
  if (next.revision < previous.revision) return true;
  if (next.revision === previous.revision) return next.digest !== previous.digest;
  return (
    next.source <= previous.source ||
    next.start < previous.end ||
    next.end <= previous.end ||
    next.captured < previous.captured ||
    next.published < previous.published ||
    next.coalesced < previous.coalesced ||
    archiveRegresses(next.archivePrefix, previous.archivePrefix)
  );
}

export function sourceTime(frame: LiveMetricSnapshot): number {
  return Math.min(frame.publishedAtMs, frame.capturedAtMs, frame.endTimeMs);
}

function archiveRegresses(
  next: LiveMetricArchivePrefix | undefined,
  previous: LiveMetricArchivePrefix | undefined,
): boolean {
  if (!next || !previous) return false;
  const sameIds =
    next.data.artifactId.toLowerCase() === previous.data.artifactId.toLowerCase() &&
    next.index.artifactId.toLowerCase() === previous.index.artifactId.toLowerCase();
  if (!sameIds || next.windows < previous.windows || targetRegresses(next.target, previous.target)) return true;
  if (next.windows > previous.windows)
    return (
      next.endTimeMs <= previous.endTimeMs ||
      next.data.bytes <= previous.data.bytes ||
      next.index.bytes <= previous.index.bytes
    );
  return !sameArchivePosition(next, previous);
}

function prefixPosition(prefix: LiveMetricArchivePrefix): LiveMetricArchivePrefix {
  return Object.freeze({
    ...prefix,
    scope: Object.freeze({ ...prefix.scope }),
    data: Object.freeze({ ...prefix.data }),
    index: Object.freeze({ ...prefix.index }),
    ...(prefix.target
      ? {
          target: Object.freeze({
            ...prefix.target,
            scope: Object.freeze({ ...prefix.target.scope }),
            data: Object.freeze({ ...prefix.target.data }),
          }),
        }
      : {}),
  });
}

function sameArchivePosition(next: LiveMetricArchivePrefix, previous: LiveMetricArchivePrefix): boolean {
  return (
    next.endTimeMs === previous.endTimeMs &&
    (['data', 'index'] as const).every(
      (lane) => next[lane].bytes === previous[lane].bytes && next[lane].sha256 === previous[lane].sha256,
    )
  );
}

function targetRegresses(
  next: LiveTargetArchivePrefix | undefined,
  previous: LiveTargetArchivePrefix | undefined,
): boolean {
  if (!next || !previous) return false;
  if (
    next.intervalMs !== previous.intervalMs ||
    next.data.artifactId.toLowerCase() !== previous.data.artifactId.toLowerCase() ||
    next.samples < previous.samples
  )
    return true;
  return next.samples > previous.samples
    ? next.data.bytes <= previous.data.bytes
    : next.data.bytes !== previous.data.bytes || next.data.sha256 !== previous.data.sha256;
}
/** Omitted enrichment never resets the private ordering baseline. */
export function rememberArchive(
  next: LiveMetricArchivePrefix | undefined,
  previous: LiveMetricArchivePrefix | undefined,
): LiveMetricArchivePrefix | undefined {
  if (!next) return previous;
  return next.target || !previous?.target ? next : Object.freeze({ ...next, target: previous.target });
}

function targetIntervalMatches(frame: LiveMetricSnapshot, interval: number | null): boolean {
  return [frame.target, frame.archivePrefix?.target].every((target) => !target || target.intervalMs === interval);
}
