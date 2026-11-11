import { createHash } from 'node:crypto';
import { captureMailboxImage } from '@beetle/contracts/live-mailbox';
import { captureLiveMetricSnapshot, decodeLiveMetricSnapshot, liveMetricScopeMatches, liveMetricSubsetText } from '@beetle/contracts/api';
import type { LiveMetricSnapshot } from '@beetle/contracts/api';
import type { LiveMetricApproval, LiveMetricReadFailure } from './types.js';
export const hash = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
export interface Position {
  readonly revision: number; readonly source: number; readonly start: number; readonly end: number; readonly captured: number; readonly published: number;
  readonly coalesced: number; readonly digest: string;
}
export function approvalSnapshot(input: LiveMetricApproval) {
  const subsetDigest = hash(liveMetricSubsetText(input.subset));
  const frame = captureLiveMetricSnapshot({version: 1, scope: input.scope, producerEpoch: input.producerEpoch,
    subset: input.subset, subsetDigest, sourceSequence: 1, publishedSequence: 1, coalescedWindows: 0,
    capturedAtMs: 0, publishedAtMs: 0, startTimeMs: 0, endTimeMs: 1000, upstreamCoverage: 'unknown', series: []}, hash);
  return {scope: frame.scope, producerEpoch: frame.producerEpoch, subsetDigest};
}
export function frameSnapshot(image: Uint8Array) {
  const envelope = captureMailboxImage(image, hash); const frame = decodeLiveMetricSnapshot(envelope.frame, hash);
  if (frame.publishedSequence !== envelope.revision) throw new Error('ordering');
  return {frame, position: {revision: envelope.revision, source: frame.sourceSequence, start: frame.startTimeMs, end: frame.endTimeMs, captured: frame.capturedAtMs,
    published: frame.publishedAtMs, coalesced: frame.coalescedWindows, digest: hash(envelope.frame)}};
}
export function frameRejection(input: {frame: LiveMetricSnapshot; position: Position; previous: Position | undefined;
  approval: ReturnType<typeof approvalSnapshot>; wall: number}): LiveMetricReadFailure | undefined {
  const {frame, position, previous, approval, wall} = input;
  if (!liveMetricScopeMatches(frame.scope, approval.scope)) return 'scope';
  if (frame.producerEpoch !== approval.producerEpoch) return 'epoch';
  if (frame.subsetDigest !== approval.subsetDigest) return 'subset';
  if (wall < Math.max(frame.publishedAtMs, frame.capturedAtMs, frame.endTimeMs) || wall - sourceTime(frame) > 6000) return 'stale';
  if (previous && ordering(position, previous)) return 'ordering';
  return undefined;
}
function ordering(next: Position, previous: Position): boolean {
  if (next.revision < previous.revision) return true;
  if (next.revision === previous.revision) return next.digest !== previous.digest;
  return next.source <= previous.source || next.start < previous.end || next.end <= previous.end || next.captured < previous.captured || next.published < previous.published || next.coalesced < previous.coalesced;
}

export function sourceTime(frame: LiveMetricSnapshot): number {return Math.min(frame.publishedAtMs, frame.capturedAtMs, frame.endTimeMs);}
