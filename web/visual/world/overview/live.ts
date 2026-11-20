// The featured live run: its saved plan (revision) and one live metric window, built as the
// app's own unit-test fixtures build them so the card shows the board's figures.
import { fixture } from '../index.js';
import type { Api, Json } from '../../harness.js';
import { NOW_MS, attemptId, revisionId, suiteIds, suiteNames } from './ids.js';
import { headerOf, liveStartedAt, runOf, runSpecs } from './runs.js';

type Obj = Record<string, Json>;

/** 1 m ramp to 1,200 a second, 8 m steady, 1 m drain (10 min planned). */
export const liveConfig: Json = {
  version: 1,
  target: 'http://checkout-api:8080',
  loadPlan: {
    version: 1,
    scenarios: [
      {
        id: 's0',
        name: 'steady',
        executor: 'ramping-arrival-rate',
        startTime: '0s',
        gracefulStop: '1m',
        startRate: 0,
        timeUnit: '1s',
        stages: [
          { duration: '1m', target: 1200 },
          { duration: '8m', target: 1200 },
        ],
        preAllocatedVUs: 100,
        maxVUs: 300,
      },
    ],
    slos: [
      { id: 'p95', metric: 'http_req_duration', stat: 'p95', operator: '<', value: 250 },
      { id: 'failed', metric: 'http_req_failed', stat: 'rate', operator: '<', value: 0.01 },
      { id: 'checks', metric: 'checks', stat: 'rate', operator: '>', value: 0.99 },
    ],
  },
  requests: [
    { id: 'checkout', name: 'Checkout', method: 'POST', path: '/checkout', query: [], headers: [], assertions: [] },
    { id: 'health', name: 'Health', method: 'GET', path: '/health', query: [], headers: [], assertions: [] },
  ],
  datasets: [],
  secrets: [],
  selections: [],
  targetSampling: { path: '/debug/process', intervalMs: 1000, timeoutMs: 500, cooldownMs: 0 },
};

const live = runSpecs[0]!;

export function liveRevision(): Obj {
  const run = runOf(live);
  return {
    ...fixture('suite-revision'),
    id: revisionId,
    suiteId: live.suiteId,
    digest: run.revisionDigest!,
    ordinal: 4,
    config: liveConfig,
  };
}

export function liveSuite(): Obj {
  return {
    ...fixture('suite'),
    id: suiteIds.steady,
    name: suiteNames[suiteIds.steady]!,
    currentRevisionId: revisionId,
  };
}

const percentile = (estimate: number) => ({
  source: 'histogram-estimate',
  scale: 0,
  estimate,
  lower: estimate,
  upper: estimate,
});
const trend = (count: number, p50: number, p95: number, p99: number): Json => ({
  kind: 'trend',
  count,
  sum: count * p50,
  min: 1,
  max: p99,
  mean: p50,
  percentiles: { p50: percentile(p50), p90: percentile(p95), p95: percentile(p95), p99: percentile(p99) },
});
const rate = (numerator: number, sampleCount: number): Json => ({
  kind: 'rate',
  numerator,
  sampleCount,
  ratio: numerator / sampleCount,
});
const gauge = (latest: number, min: number, max: number): Json => ({
  kind: 'gauge',
  latest,
  sourceTimeMs: NOW_MS - 1,
  min,
  max,
});
const request = (label: string, metric: string, kind: string): Obj => ({
  metric,
  kind,
  scope: 'execute',
  tags: { phase: 'execute', request: label },
});
const engine = (metric: string): Obj => ({ metric, kind: 'gauge', scope: 'engine', tags: {} });

/** One 1 s window, two endpoints (r0 p95 236 ms, 0.22% failed; r1) and VUs. */
export function liveFrame(): Obj {
  const parts: [Obj, string, Json][] = [
    [request('r0', 'http_req_duration', 'trend'), 'ms', trend(900, 57, 236, 281)],
    [request('r0', 'http_req_failed', 'rate'), 'ratio', rate(2, 900)],
    [request('r1', 'http_req_duration', 'trend'), 'ms', trend(300, 4, 12, 20)],
    [request('r1', 'http_req_failed', 'rate'), 'ratio', rate(0, 300)],
    [engine('vus'), 'count', gauge(142, 140, 150)],
    [engine('vus_max'), 'count', gauge(300, 300, 300)],
  ];
  return {
    ...fixture('live-metric-snapshot'),
    scope: {
      organizationId: '00000000-0000-4000-8000-000000000001',
      workspaceId: '00000000-0000-4000-8000-000000000002',
      attemptId,
      generation: 1,
    },
    subset: { selected: parts.map(([row], ordinal) => ({ ...row, ordinal })), excludedSeries: 3 },
    subsetDigest: '5080afd6fae96eade2d5b91993a5fc6c275a1723c6398e509aa62db238ff22a5',
    publishedSequence: 1,
    sourceSequence: 1,
    coalescedWindows: 0,
    capturedAtMs: NOW_MS,
    publishedAtMs: NOW_MS,
    startTimeMs: NOW_MS - 1000,
    endTimeMs: NOW_MS,
    series: parts.map(([row, unit, total], ordinal) => ({ ...row, ordinal, unit, total })),
  };
}

/** Answers the reads the live card makes for the featured run (run, suite, revision, live window). */
export function liveRunHandlers(api: Api): Api {
  return api
    .on('getRun', runOf(live))
    .on('getSuite', liveSuite())
    .on('getSuiteRevision', liveRevision())
    .on('getRunLiveMetrics', { status: 200, headers: { 'x-beetle-live-fresh-for-ms': '6000' }, body: liveFrame() });
}

export { headerOf, liveStartedAt };
