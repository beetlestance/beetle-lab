// Metric frames for the live run: a ramped 1,200 a second plan over five endpoints, drawn from
// elapsed seconds so every frame, history sample and target reading is deterministic.
import { createHash } from 'node:crypto';
import { liveMetricSubsetText } from '@beetle/contracts/api';
import type { Json } from '../../harness.js';
import { ids } from '../index.js';

export const liveIds = {
  run: 'a7f20000-0000-4000-8000-000000000001',
  attempt: 'a7f20000-0000-4000-8000-0000000000a1',
  suite: '51e00000-0000-4000-8000-000000000001',
  revision: '51e00000-0000-4000-8000-0000000000e4',
  epoch: 'a7f20000-0000-4000-8000-0000000000e1',
  dataArtifact: 'a7f20000-0000-4000-8000-0000000000d1',
  indexArtifact: 'a7f20000-0000-4000-8000-0000000000d2',
  targetArtifact: 'a7f20000-0000-4000-8000-0000000000d3',
} as const;

/** Planned shape: 1 m ramp, 8 m steady, 1 m drain. */
export const endpoints = [
  { name: 'Checkout', method: 'POST', path: '/checkout', share: 0.11, p50: 57, p95: 236, p99: 281, fail: 0.0021 },
  { name: 'Cart', method: 'POST', path: '/cart', share: 0.34, p50: 48, p95: 198, p99: 250, fail: 0.0005 },
  { name: 'Product', method: 'GET', path: '/product/{id}', share: 0.22, p50: 41, p95: 171, p99: 220, fail: 0.0002 },
  { name: 'Catalog', method: 'GET', path: '/catalog/search', share: 0.28, p50: 34, p95: 142, p99: 190, fail: 0.0001 },
  { name: 'Health', method: 'GET', path: '/health', share: 0.05, p50: 4, p95: 12, p99: 20, fail: 0 },
] as const;

type Row = { ordinal: number; metric: string; kind: string; scope: string; tags: Record<string, string> };
const rows: Row[] = [
  ...endpoints.flatMap((_, i) => [
    { metric: 'http_req_duration', kind: 'trend', scope: 'execute', tags: { phase: 'execute', request: `r${i}` } },
    { metric: 'http_req_failed', kind: 'rate', scope: 'execute', tags: { phase: 'execute', request: `r${i}` } },
  ]),
  { metric: 'beetle_checks_passing', kind: 'rate', scope: 'execute', tags: { phase: 'execute' } },
  { metric: 'vus', kind: 'gauge', scope: 'engine', tags: {} },
  { metric: 'vus_max', kind: 'gauge', scope: 'engine', tags: {} },
].map((row, ordinal) => ({ ...row, ordinal }));
export const subset = { selected: rows, excludedSeries: 3 };
export const subsetDigest = createHash('sha256').update(liveMetricSubsetText(subset)).digest('hex');

const wave = (e: number, seed: number) => Math.sin(e * 0.9 + seed) * 0.5 + Math.sin(e * 2.3 + seed * 3) * 0.5;
const load = (e: number) => (e < 60 ? 1200 * (e / 60) : 1200 + wave(e, 1) * 14);
const slow = (e: number, seed: number) => (0.28 + 0.72 * Math.min(1, e / 60)) * (1 + wave(e, seed) * 0.04);

const percentile = (estimate: number) => ({
  source: 'histogram-estimate',
  scale: 0,
  estimate,
  lower: estimate,
  upper: estimate,
});
function seriesAt(e: number, startMs: number, endMs: number): Json[] {
  const rps = load(e);
  let total = 0;
  const out: Json[] = [];
  endpoints.forEach((ep, i) => {
    const count = Math.max(2, Math.round(rps * ep.share));
    total += count;
    const f = slow(e, i + 1);
    const at = (value: number) => Math.max(1, Math.round(value * f));
    const [p50, p90, p95, p99] = [at(ep.p50), at(ep.p95 * 0.9), at(ep.p95), at(ep.p99)];
    out.push({
      ...rows[i * 2]!,
      unit: 'ms',
      total: {
        kind: 'trend',
        count,
        sum: count * p50,
        min: 1,
        max: Math.round(p99 * 1.2) + 1,
        mean: p50,
        percentiles: { p50: percentile(p50), p90: percentile(p90), p95: percentile(p95), p99: percentile(p99) },
      },
    } as Json);
    // Spread the expected failures over windows: each window carries a whole number of them.
    const failed = Math.floor(count * ep.fail * 2.2 + ((e * 0.618 + i * 0.37) % 1));
    out.push({
      ...rows[i * 2 + 1]!,
      unit: 'ratio',
      total: { kind: 'rate', numerator: Math.max(0, failed), sampleCount: count, ratio: Math.max(0, failed) / count },
    } as Json);
  });
  out.push({
    ...rows[10]!,
    unit: 'ratio',
    total: { kind: 'rate', numerator: total - 1, sampleCount: total, ratio: (total - 1) / total },
  } as Json);
  const vus = Math.round(rps * 0.12);
  const gauge = (value: number) => ({
    kind: 'gauge',
    latest: value,
    sourceTimeMs: endMs - 1,
    min: Math.max(0, value - 4),
    max: value + 4,
  });
  out.push({ ...rows[11]!, unit: 'count', total: gauge(vus) } as Json);
  out.push({ ...rows[12]!, unit: 'count', total: gauge(300) } as Json);
  void startMs;
  return out;
}

const scope = {
  organizationId: ids.organization,
  workspaceId: ids.workspace,
  attemptId: liveIds.attempt,
  generation: 1,
};
const artifact = (artifactId: string, relativePath: string, bytes: number) => ({
  artifactId,
  relativePath,
  bytes,
  sha256: 'c'.repeat(64),
});

/** Target-reported process figures `seconds` into the run. */
function targetValues(e: number) {
  const ramp = Math.min(1, e / 60);
  return {
    rss: Math.round(380 + 190 * ramp + wave(e, 2) * 6),
    heapAlloc: null,
    heapInuse: null,
    usedHeapSize: Math.round(250 + 150 * ramp + wave(e, 3) * 8),
    totalHeapSize: 500,
    cpuPercent: Math.round(20 + 44 * ramp + wave(e, 4) * 3),
    systemCpuPercent: Math.round(10 + 28 * ramp + wave(e, 6) * 2),
    'eventLoopDelay.mean': Math.round((2 + 7.5 * ramp + wave(e, 7)) * 10) / 10,
    'eventLoopDelay.p99': Math.round((6 + 16 * ramp + wave(e, 8) * 2) * 10) / 10,
    'eventLoopDelay.max': Math.round((10 + 22 * ramp + wave(e, 9) * 3) * 10) / 10,
    activeHandles: Math.round(60 + 108 * ramp + wave(e, 10) * 3),
    goroutines: null,
  };
}

/** One 1 s live window ending `e` seconds after the run began. */
export function liveFrame(startedMs: number, e: number): Json {
  const endMs = startedMs + e * 1000;
  const startMs = endMs - 1000;
  return {
    version: 1,
    scope,
    producerEpoch: liveIds.epoch,
    subsetDigest,
    subset,
    sourceSequence: e,
    publishedSequence: e,
    coalescedWindows: 0,
    capturedAtMs: endMs,
    publishedAtMs: endMs,
    startTimeMs: startMs,
    endTimeMs: endMs,
    upstreamCoverage: 'unknown',
    series: seriesAt(e, startMs, endMs),
    target: {
      scope: 'target-reported',
      intervalMs: 1000,
      omittedSamples: 0,
      samples: [1, 0].map((back) => ({
        observedAtMs: endMs - 1 - back * 500,
        phase: 'during',
        status: 'ready',
        values: targetValues(e - back / 2),
      })),
    },
    archivePrefix: {
      scope,
      windows: e,
      endTimeMs: endMs,
      data: artifact(liveIds.dataArtifact, 'metric-windows.ndjson', 4096 * e),
      index: artifact(liveIds.indexArtifact, 'metric-index.ndjson', 64 * e),
    },
  };
}

const targetKeys = [
  'heapAlloc',
  'heapInuse',
  'heapIdle',
  'heapSys',
  'heapReleased',
  'heapObjects',
  'stackInuse',
  'rss',
  'external',
  'arrayBuffers',
  'totalHeapSize',
  'usedHeapSize',
  'heapSizeLimit',
  'mallocedMemory',
  'peakMallocedMemory',
  'goroutines',
  'activeRequests',
  'numCPU',
  'totalMemory',
  'freeMemory',
  'uptime',
  'cpuPercent',
  'systemCpuPercent',
  'uvThreadpoolSize',
  'cppHeap.allocated_size',
  'cppHeap.used_size',
  'eventLoopDelay.mean',
  'eventLoopDelay.p90',
  'eventLoopDelay.p99',
  'eventLoopDelay.max',
  'gc.count',
  'gc.duration',
  'activeHandles',
  'gc.totalMs',
  'gc.maxMs',
  'gc.avgMs',
];
function recordedTarget(startedMs: number, e: number): Json {
  const live = targetValues(e) as Record<string, number | null>;
  const values = Object.fromEntries(targetKeys.map((key) => [key, live[key] ?? null]));
  return {
    observedAt: new Date(startedMs + e * 1000 - 500).toISOString(),
    phase: 'during',
    status: 'ready',
    reason: null,
    values,
  };
}

/** The recorded prefix: every fifth window from the start up to second `through`, and one target sample per 5 s. */
export function liveHistory(startedMs: number, through: number): Json {
  const seconds = [1];
  for (let s = 5; s < through; s += 5) seconds.push(s);
  if (through > 1) seconds.push(through);
  const targets = seconds.slice(1);
  const endMs = startedMs + through * 1000;
  return {
    scope,
    prefix: {
      scope,
      windows: through,
      endTimeMs: endMs,
      data: artifact(liveIds.dataArtifact, 'metric-windows.ndjson', 4096 * through),
      index: artifact(liveIds.indexArtifact, 'metric-index.ndjson', 64 * through),
      target: {
        scope,
        samples: targets.length,
        intervalMs: 1000,
        data: artifact(liveIds.targetArtifact, 'target-samples.ndjson', 512 * targets.length),
      },
    },
    producerEpoch: liveIds.epoch,
    subset,
    subsetDigest,
    sampled: true,
    samples: seconds.map((s) => ({
      sequence: s,
      startTimeMs: startedMs + (s - 1) * 1000,
      endTimeMs: startedMs + s * 1000,
      series: seriesAt(s, startedMs + (s - 1) * 1000, startedMs + s * 1000),
    })),
    targetSamples: targets.map((s) => recordedTarget(startedMs, s)),
  };
}
