import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import type {ApiClient, Run} from '@beetle/contracts/api';
import type {DockerTransport} from '../../../../agent/src/backends/docker/index.js';
import type {Peer} from '../load/observe.js';
import {sample, summarize} from '../load/measure.js';
import type {Sample} from '../load/measure.js';
import {value} from '../public-api.js';
import {latency, reader, timed} from './readers.js';
import type {Timing} from './readers.js';
interface Options {readonly api: ApiClient; readonly subscribers: readonly ApiClient[]; readonly queued: Run;
 readonly peers: readonly Peer[]; readonly transport: DockerTransport;
 readonly checkpoint: (part: unknown) => void; readonly onActive: (run: Run) => boolean}
function observedSpan(start: number | undefined, end: number | undefined) {
 return start === undefined || end === undefined ? null : end - start;
}
/** Independent settled readers; every started loop and original must drain before return/cleanup. */
export async function longWindow(options: Options) {
 const {api, queued, peers, transport, checkpoint} = options; assert.equal(options.subscribers.length, 3);
 const calls: Timing[] = []; const readers = options.subscribers.map(api => reader(api, queued, calls));
 const series = peers.map((): Sample[] => []); const started = performance.now(); let activeAt: number | undefined;
 let activeEndedAt: number | undefined; let latest = queued; let terminal: Run | undefined; const stop = new AbortController(); let failed: unknown;
 const loop = async (interval: number, work: () => Promise<void>) => {
  try {while (!stop.signal.aborted) {
   assert(performance.now() - started < 33 * 60000); await work();
   if (!stop.signal.aborted) await delay(interval, undefined, {signal: stop.signal}).catch(error => {if (!stop.signal.aborted) throw error;});
  }} catch (error) {failed ??= error; stop.abort();}
 };
 const jobs = [loop(2000, async () => {
  const reply = await timed(calls, 'run', () => api.getRun({params: {organizationId: queued.scope.organizationId, workspaceId: queued.scope.workspaceId, runId: queued.id}}));
  latest = value(reply); assert.equal(latest.activeAttemptId, queued.activeAttemptId);
  if (latest.state === 'active') {if (activeAt === undefined && options.onActive(latest)) activeAt = performance.now();}
  else if (activeAt !== undefined) activeEndedAt ??= performance.now();
  if (['finished', 'errored', 'cancelled'].includes(latest.state)) {terminal = latest; stop.abort();}
 }), loop(15000, async () => {
  const outcomes = await Promise.allSettled(peers.map(peer => sample(transport, peer.id)));
  const rows = outcomes.map(outcome => {if (outcome.status === 'rejected') throw outcome.reason; return outcome.value;});
  rows.forEach((row, index) => {assert(series[index]!.length < 128); series[index]!.push(row);});
 }), ...readers.map(item => loop(2000, async () => {if (latest.state === 'active') await item.read();}))];
 try {
  await Promise.allSettled(jobs); if (failed !== undefined) throw failed;
  assert(terminal && activeAt !== undefined && activeEndedAt !== undefined); assert.equal(terminal.state, 'finished'); assert.equal(terminal.outcome, 'passed'); assert.equal(terminal.reason, null);
  const activeMs = activeEndedAt - activeAt; assert(activeMs >= 1800000 && activeMs < 32 * 60000);
  const observations = readers.map(item => item.result());
  for (const item of observations) {
   assert(item.frames >= 2 && item.firstFrameMs !== null && item.lastFrameMs !== null);
   // Actual fresh frames span the observation; any unavailable gaps remain reported.
   assert(item.lastFrameMs - item.firstFrameMs >= 29 * 60000);
  }
  return {run: terminal, activeMs, elapsedMs: performance.now() - started, readers: observations,
   peers: peers.map((peer, index) => ({role: peer.role, ...summarize(series[index]!, peer.memory)})), latency: latency(calls)};
 } finally {checkpoint({series, calls, readers: readers.map(item => item.result()), activeObservedAtMs: activeAt === undefined ? null : activeAt - started,
  elapsedMs: performance.now() - started, terminal: terminal ?? null, activeMs: observedSpan(activeAt, activeEndedAt)});}
}
