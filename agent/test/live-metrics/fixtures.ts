import { createHash } from 'node:crypto';
import { encodeLiveMetricSnapshot, liveMetricSubsetText } from '@beetle/contracts/api';
import type { LiveMetricSnapshot } from '@beetle/contracts/api';
import { encodeMailboxHeader, MAILBOX_BYTES, MAILBOX_HEADER_BYTES, MAILBOX_FOOTER_OFFSET } from '@beetle/contracts/live-mailbox';
import { LiveMetricReader } from '../../src/live-metrics/index.js';
import type { MailboxArchiveReply, Operation } from '../../src/backends/docker/index.js';
export const hash = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
export function frame(patch: Partial<LiveMetricSnapshot> = {}): LiveMetricSnapshot {
  const subset = {selected: [{ordinal: 0, metric: 'beetle_requests', kind: 'counter' as const,
    scope: 'execute' as const, tags: {phase: 'execute' as const, request: 'r0'}}], excludedSeries: 0};
  return {version: 1, scope: {organizationId: '00000000-0000-4000-8000-000000000001',
    workspaceId: '00000000-0000-4000-8000-000000000002', attemptId: '00000000-0000-4000-8000-000000000003', generation: 1},
    producerEpoch: '00000000-0000-4000-8000-000000000004', subset, subsetDigest: hash(liveMetricSubsetText(subset)),
    sourceSequence: 1, publishedSequence: 1, coalescedWindows: 0, capturedAtMs: 1000, publishedAtMs: 1000,
    startTimeMs: 0, endTimeMs: 1000, upstreamCoverage: 'unknown', series: [], ...patch};
}
export function image(value: LiveMetricSnapshot, revision = value.publishedSequence): Uint8Array {
  const body = encodeLiveMetricSnapshot(value, hash); const bytes = new Uint8Array(MAILBOX_BYTES);
  const header = encodeMailboxHeader({revision, length: body.length, digest: hash(body), committed: true});
  bytes.set(header); bytes.set(body, MAILBOX_HEADER_BYTES); bytes.set(header, MAILBOX_FOOTER_OFFSET); return bytes;
}
export function deferred<T>() {
  let resolve!: (value: T) => void; const promise = new Promise<T>(pass => {resolve = pass;}); return {promise, resolve};
}
export function fixture() {
  let wall = 1000; let monotonic = 0; const initial = frame();
  let reply: MailboxArchiveReply = {ok: true, status: 200, image: image(initial)};
  let calls = 0; let port: ((operation: Operation) => Promise<MailboxArchiveReply>) | undefined;
  const reader = new LiveMetricReader({approval: {scope: initial.scope, producerEpoch: initial.producerEpoch, subset: initial.subset},
    clock: {wall: () => wall, monotonic: () => monotonic}, read: async operation => {calls++; return port ? port(operation) : reply;}});
  return {reader, initial, calls: () => calls, operation: (): Operation => ({deadline: monotonic + 5000}),
    clock(nextWall: number, nextMono = monotonic) {wall = nextWall; monotonic = nextMono;},
    set(value: MailboxArchiveReply) {reply = value;}, port(value: (operation: Operation) => Promise<MailboxArchiveReply>) {port = value;}};
}
