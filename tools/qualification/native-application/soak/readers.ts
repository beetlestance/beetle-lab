import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {captureLiveMetricSnapshot} from '@beetle/contracts/api';
import {encodeCanonicalJson} from '@beetle/contracts';
import type {ApiClient, ApiClientResult, LiveMetricSnapshot, Run} from '@beetle/contracts/api';
export interface Timing {readonly endpoint: 'run' | 'live'; readonly durationMs: number; readonly status: number; readonly code: string | null}
export async function timed<T>(calls: Timing[], endpoint: Timing['endpoint'], action: () => Promise<ApiClientResult<T>>) {
 assert(calls.length < 8192); const start = performance.now(); let reply: ApiClientResult<T> | undefined;
 try {reply = await action(); return reply;}
 finally {calls.push({endpoint, durationMs: performance.now() - start, status: reply?.ok ? 200 : reply?.error.status ?? 0,
  code: reply && !reply.ok ? reply.error.protocol?.code ?? reply.error.kind : null});}
}
export function transient<T>(reply: ApiClientResult<T>): boolean {
 if (reply.ok) return false;
 assert(reply.error.kind === 'protocol' && (reply.error.status === 429 && reply.error.protocol?.code === 'rate_limited'
  || reply.error.status === 503 && ['capacity_unavailable', 'storage_unavailable'].includes(reply.error.protocol?.code ?? '')));
 return true;
}
export function latency(calls: readonly Timing[]) {
 assert(calls.length > 0 && calls.length <= 8192);
 const p95 = (rows: readonly Timing[]) => {if (!rows.length) return null;
  const sorted = rows.map(row => row.durationMs).sort((a, b) => a - b); return sorted[Math.ceil(sorted.length * .95) - 1]!;};
 return ['run', 'live'].flatMap(endpoint => {const rows = calls.filter(row => row.endpoint === endpoint); if (!rows.length) return [];
  const successful = rows.filter(row => row.status === 200);
  return [{endpoint, attempted: rows.length, successful: successful.length, unavailable: rows.length - successful.length,
   allP95Ms: p95(rows), successfulP95Ms: p95(successful)}];});
}
export function reader(api: ApiClient, queued: Run, calls: Timing[]) {
 let last: LiveMetricSnapshot | undefined; let frames = 0; let unavailable = 0; let polls = 0;
 let firstFrameMs: number | null = null; let lastFrameMs: number | null = null; let longestNewFrameGapMs = 0;
 const start = performance.now();
 return {
  async read() {
   assert(++polls <= 1100);
   const reply = await timed(calls, 'live', () => api.getRunLiveMetrics({params: {organizationId: queued.scope.organizationId,
    workspaceId: queued.scope.workspaceId, runId: queued.id, attemptId: queued.activeAttemptId}}));
   if (transient(reply)) {unavailable++; return;}
   assert(reply.ok);
   const current = captureLiveMetricSnapshot(reply.value, bytes => createHash('sha256').update(bytes).digest('hex'));
   assert(Buffer.byteLength(encodeCanonicalJson(current, 65536)) <= 65536);
   if (last) {
    assert.equal(current.producerEpoch, last.producerEpoch); assert.equal(current.subsetDigest, last.subsetDigest);
    assert(current.publishedSequence >= last.publishedSequence && current.sourceSequence >= last.sourceSequence);
   }
   if (!last || current.publishedSequence > last.publishedSequence) {
    const at = performance.now() - start; frames++; firstFrameMs ??= at;
    if (lastFrameMs !== null) longestNewFrameGapMs = Math.max(longestNewFrameGapMs, at - lastFrameMs); lastFrameMs = at;
   }
   last = current;
  },
  result() {return {frames, unavailable, polls, firstFrameMs, lastFrameMs, longestNewFrameGapMs, lastSnapshot: last ?? null,
   tailWithoutNewFrameMs: lastFrameMs === null ? performance.now() - start : performance.now() - start - lastFrameMs};},
 };
}
