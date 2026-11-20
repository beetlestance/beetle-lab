// Measurements for one finished run: whole-run overview, per-window chart history, target
// runtime samples. All derived from a profile and the time the run was stopped at.
import type { Json } from '../../harness.js';
import type { Profile } from './profiles.js';
import { rng } from './profiles.js';

const pct = (estimate: number): Json => ({
  source: 'histogram-estimate',
  scale: 4,
  estimate,
  lower: Math.round(estimate * 0.985 * 10) / 10,
  upper: Math.round(estimate * 1.015 * 10) / 10,
});
const trend = (count: number, p50: number, p95: number, p99: number): Json => {
  const sum = Math.round(count * p50 * 1.3);
  return {
    kind: 'trend',
    count,
    sum,
    min: Math.max(1, Math.round(p50 * 0.3)),
    max: Math.round(p99 * 3.1),
    mean: sum / count,
    percentiles: { p50: pct(p50), p90: pct(Math.round((p50 + p95) / 2)), p95: pct(p95), p99: pct(p99) },
  };
};
const rate = (numerator: number, sampleCount: number): Json => ({
  kind: 'rate',
  numerator,
  sampleCount,
  ratio: sampleCount === 0 ? null : numerator / sampleCount,
});

export interface Timing {
  readonly startedMs: number;
  /** How long the measured part of the run lasted. */
  readonly ranMs: number;
}
export const requestsOf = (p: Profile, ranMs: number) => Math.round((p.rps * ranMs) / 1000);

export function source(p: Profile, t: Timing, manifest = 'c'): Json {
  return {
    generation: 1,
    manifestDigest: manifest.repeat(64),
    numericArtifactId: 'f952b21b-be56-4107-93d2-92f413d20df6',
    numericSha256: 'b'.repeat(64),
    numericVersion: 4,
    measurementSourceTimeMs: t.startedMs,
    coverage: { complete: true, latePoints: 0, markerDelayDroppedBuckets: 0 },
  };
}

/** Largest-remainder split so the endpoint counts add up to the whole-run total exactly. */
function split(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((w) => (total * w) / sum);
  const counts = raw.map(Math.floor);
  let left = total - counts.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (left-- <= 0) break;
    counts[i]! += 1;
  }
  return counts;
}

export function overview(p: Profile, t: Timing, ids: { run: string; attempt: string; scope: Json }): Json {
  const total = requestsOf(p, t.ranMs);
  const counts = split(
    total,
    p.endpoints.map((e) => e.weight),
  );
  const failed = p.endpoints.map((e, i) => Math.round(counts[i]! * e.failed));
  const rows: Json[] = p.endpoints.map((e, i) => ({
    request: `r${i}`,
    requestCount: counts[i]!,
    requestsPerSecond: (counts[i]! * 1000) / t.ranMs,
    failure: rate(failed[i]!, counts[i]!),
    latency: trend(counts[i]!, e.p50, e.p95, Math.round(e.p95 * 1.5)),
  }));
  const checks = total * 2;
  const passed = Math.round(checks * p.checkRatio);
  return {
    id: ids.run,
    scope: ids.scope,
    attemptId: ids.attempt,
    availability: 'ready',
    source: source(p, t),
    scenarioStartedAtMs: t.startedMs,
    testDurationMs: t.ranMs,
    requestCount: total,
    requestsPerSecond: (total * 1000) / t.ranMs,
    failure: rate(
      failed.reduce((a, b) => a + b, 0),
      total,
    ),
    latency: trend(total, p.p50, p.p95, p.p99),
    checks: { passed, total: checks, ratio: passed / checks },
    droppedIterations: 0,
    endpoints: rows,
    omittedEndpoints: 0,
  };
}

/** Same running mean the app uses, so a complete history reproduces meanVus exactly. */
function runningMean(values: readonly number[]): number {
  let result = 0;
  values.forEach((value, index) => {
    result += (value - result) / (index + 1);
  });
  return result;
}

/** One-second windows; above 900 the app expects evenly chosen ordinals with both ends kept. */
export function chartHistory(p: Profile, t: Timing, ids: { run: string; attempt: string; scope: Json }): Json {
  const next = rng(p.rps);
  const windows = Math.floor(t.ranMs / 1000);
  const picked = Math.min(900, windows);
  const ordinals = Array.from({ length: picked }, (_, i) => 1 + Math.floor((i * (windows - 1)) / (picked - 1)));
  const vus: number[] = [];
  const points: Json[] = ordinals.map((sequence, i) => {
    const at = (sequence - 1) * 1000;
    const ramp = Math.min(1, (at + 1000) / p.rampMs);
    const requests = Math.min(p.peak, Math.round(p.rps * ramp * (0.97 + next() * 0.06)));
    const level = (0.55 + 0.45 * ramp) * (sequence % 97 === 0 ? 1.18 : 1);
    vus.push(Math.round(p.vusBusy * (0.3 + 0.7 * ramp) * (0.97 + next() * 0.06)));
    return {
      sequence,
      startTimeMs: t.startedMs + at,
      endTimeMs: t.startedMs + at + 1000,
      gapBefore: false,
      requestCount: i === Math.min(300, picked - 1) && windows <= 900 ? p.peak : requests,
      httpFailures: Math.round(requests * p.failRatio * (0.5 + next())),
      httpSamples: requests,
      httpP50: pct(Math.round(p.p50 * (0.7 + 0.3 * ramp) * (0.97 + next() * 0.06))),
      httpP95: pct(Math.round(p.p95 * level * (0.96 + next() * 0.08))),
      httpP99: pct(Math.round(p.p99 * level * (0.95 + next() * 0.1))),
      vus: vus[i]!,
      vusMax: p.vusMax,
    };
  });
  return {
    id: ids.run,
    scope: ids.scope,
    attemptId: ids.attempt,
    source: source(p, t),
    windows,
    sampled: windows > 900,
    points,
    observedPeakRequestsPerSecond: p.peak,
    knownRequestWindows: windows,
    reason: null,
    meanVus: windows > 900 ? p.vusBusy : runningMean(vus),
    knownVusWindows: windows,
  };
}

const NO_VALUES = [
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

/** Node target samples: three before, one every 5 s during the run, four after. */
export function targetReport(p: Profile, t: Timing): Json {
  const next = rng(p.rps + 7);
  const sample = (offsetMs: number, phase: string, load: number): Json => {
    const values: Record<string, Json> = Object.fromEntries(NO_VALUES.map((k) => [k, null]));
    values.usedHeapSize = Math.round(150 + 250 * load + next() * 14);
    values.rss = Math.round(240 + 330 * load + next() * 10);
    values.cpuPercent = Math.round(4 + 62 * load + next() * 5);
    values.systemCpuPercent = Math.round(3 + 36 * load + next() * 4);
    values['eventLoopDelay.mean'] = Math.round((1.5 + 8 * load + next()) * 10) / 10;
    values['eventLoopDelay.p99'] = Math.round((4 + 18 * load + next() * 3) * 10) / 10;
    values['eventLoopDelay.max'] = Math.round((6 + 26 * load + next() * 5) * 10) / 10;
    values.activeHandles = Math.round(12 + 156 * load + next() * 4);
    return { observedAt: new Date(t.startedMs + offsetMs).toISOString(), phase, status: 'ready', reason: null, values };
  };
  const samples: Json[] = [-12000, -8000, -4000].map((at) => sample(at, 'before', 0.05));
  for (let at = 0; at < t.ranMs; at += 5000)
    samples.push(sample(at, 'during', Math.min(1, (at + 5000) / p.rampMs) * (0.95 + next() * 0.05)));
  for (let k = 1; k <= 4; k++) samples.push(sample(t.ranMs + k * 4000, 'after', 0.35 / k));
  return {
    format: 'beetle-target-runtime',
    version: 1,
    scope: 'target-reported',
    samples,
    limited: false,
    missed: 0,
    units: {
      usedHeapSize: 'megabytes',
      rss: 'megabytes',
      cpuPercent: 'percent',
      systemCpuPercent: 'percent',
      'eventLoopDelay.mean': 'milliseconds',
      'eventLoopDelay.p99': 'milliseconds',
      'eventLoopDelay.max': 'milliseconds',
      activeHandles: 'count',
    },
  };
}
