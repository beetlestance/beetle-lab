import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {captureLiveMetricSnapshot} from '@beetle/contracts/api';
import {encodeCanonicalJson} from '@beetle/contracts';
import type {ApiClient, ApiClientResult, Run, LiveMetricSnapshot} from '@beetle/contracts/api';
import type {DockerTransport} from '../../../../agent/src/backends/docker/index.js';
import {value, pause} from '../public-api.js';
import {sample, summarize, percentile} from './measure.js';
import type {Sample} from './measure.js';
import {measuredCall} from './network.js';
export interface Peer {readonly role: string; readonly id: string; readonly memory: number}
interface Call {readonly id: number; readonly endpoint: 'settings' | 'run' | 'live'; readonly durationMs: number; readonly outcome: string; readonly status: number; readonly protocolCode: string | null}
type Checkpoint = (input: {series: readonly (readonly Sample[])[]; calls: readonly Call[]; readFailures: number}) => void;
interface Reader {readonly api: ApiClient; last?: LiveMetricSnapshot; frames: number; unavailable: number}
function callOutcome(reply: ApiClientResult<unknown> | undefined) {
  if (!reply) return {outcome: 'thrown', status: 0, protocolCode: null};
  if (reply.ok) return {outcome: 'ok', status: 200, protocolCode: null};
  return {outcome: reply.error.kind, status: reply.error.status ?? 0, protocolCode: reply.error.protocol?.code ?? null};
}
async function timed<T>(calls: Call[], endpoint: Call['endpoint'], action: () => Promise<ApiClientResult<T>>): Promise<ApiClientResult<T>> {
  assert(calls.length < 512);
  return measuredCall(async id => {
    const start = performance.now(); let reply: ApiClientResult<T> | undefined;
    try {reply = await action(); return reply;}
    finally {calls.push({id, endpoint, durationMs: performance.now() - start, ...callOutcome(reply)});}
  });
}
function latency(calls: readonly Call[]) {
  return {attempted: calls.length, successful: calls.filter(call => call.outcome === 'ok').length,
    failed: calls.filter(call => call.outcome !== 'ok').length, apiP95Ms: percentile(calls.map(call => call.durationMs), 0.95),
    endpoints: ['settings', 'run', 'live'].flatMap(endpoint => {
      const items = calls.filter(call => call.endpoint === endpoint); return items.length ? [{endpoint, attempted: items.length,
        failed: items.filter(call => call.outcome !== 'ok').length, p95Ms: percentile(items.map(call => call.durationMs), 0.95)}] : [];
    })};
}
async function frame(reader: Reader, run: Run, timings: Call[]) {
  const reply = await timed(timings, 'live', () => reader.api.getRunLiveMetrics({params: {organizationId: run.scope.organizationId, workspaceId: run.scope.workspaceId, runId: run.id, attemptId: run.activeAttemptId}}));
  if (!reply.ok) {assert(reply.error.status === 503 || reply.error.status === 429); reader.unavailable++; return;}
  const current = captureLiveMetricSnapshot(reply.value, bytes => createHash('sha256').update(bytes).digest('hex'));
  assert(Buffer.byteLength(encodeCanonicalJson(current, 65536)) <= 65536);
  const previous = reader.last;
  if (previous) {
    assert.equal(current.producerEpoch, previous.producerEpoch); assert.equal(current.subsetDigest, previous.subsetDigest);
    assert(current.publishedSequence >= previous.publishedSequence && current.sourceSequence >= previous.sourceSequence);
  }
  if (!previous || current.publishedSequence > previous.publishedSequence) reader.frames++;
  reader.last = current;
}
function window(peers: readonly Peer[], transport: DockerTransport) {
  const series = peers.map((): Sample[] => []);
  return {
    async read() {const rows = await Promise.all(peers.map(peer => sample(transport, peer.id))); rows.forEach((row, index) => {assert(series[index]!.length < 128); series[index]!.push(row);});},
    raw() {return series;},
    finish() {return peers.map((peer, index) => ({role: peer.role, id: peer.id, ...summarize(series[index]!, peer.memory)}));},
  };
}
export function readFailed<T>(reply: ApiClientResult<T>): boolean {
  if (reply.ok) return false;
  assert(reply.error.kind === 'timeout' || reply.error.kind === 'transport' || [429, 503].includes(reply.error.status ?? 0), 'Unexpected measurement refusal');
  return true;
}
export async function idle(peers: readonly Peer[], transport: DockerTransport, api: ApiClient, checkpoint: Checkpoint) {
  const measurements = window(peers, transport); const timings: Call[] = []; const start = performance.now(); let readFailures = 0;
  try {
    for (let calls = 0; calls < 40 && performance.now() - start < 8000; calls++) {
      await measurements.read(); if (readFailed(await timed(timings, 'settings', () => api.getInstallationSettings()))) readFailures++;
      await pause(); await pause();
    }
    assert(performance.now() - start >= 8000);
    return {peers: measurements.finish(), apiCalls: timings.length, ...latency(timings), readFailures};
  } finally {checkpoint({series: measurements.raw(), calls: timings, readFailures});}
}
interface LoadedOptions {readonly api: ApiClient; readonly subscribers: readonly ApiClient[]; readonly queued: Run; readonly checkpoint: Checkpoint}
export async function loaded(peers: readonly Peer[], transport: DockerTransport, options: LoadedOptions) {
  const {api, subscribers, queued, checkpoint} = options;
  assert.equal(subscribers.length, 3); const readers: Reader[] = subscribers.map(api => ({api, frames: 0, unavailable: 0}));
  const measurements = window(peers, transport); const timings: Call[] = []; const start = performance.now(); let readFailures = 0;
  try {
    for (let calls = 0; calls < 100 && performance.now() - start < 90000; calls++) {
      await measurements.read();
      const reply = await timed(timings, 'run', () => api.getRun({params: {organizationId: queued.scope.organizationId, workspaceId: queued.scope.workspaceId, runId: queued.id}}));
      if (readFailed(reply)) {readFailures++; await pause(); await pause(); continue;}
      const run = value(reply);
      if (['finished', 'errored', 'cancelled'].includes(run.state)) {
        assert.equal(run.state, 'finished'); assert.equal(run.outcome, 'passed'); assert.equal(run.reason, null);
        assert(readers.every(reader => reader.frames >= 2));
        return {peers: measurements.finish(), apiCalls: timings.length, ...latency(timings), readFailures, elapsedMs: performance.now() - start,
          run, readers: readers.map(reader => ({frames: reader.frames, unavailable: reader.unavailable}))};
      }
      if (run.state === 'active') await Promise.all(readers.map(reader => frame(reader, run, timings)));
      await pause(); await pause();
    }
    throw Error('Bounded loaded window did not settle');
  } finally {checkpoint({series: measurements.raw(), calls: timings, readFailures});}
}
