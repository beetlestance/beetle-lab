// The Runs list for workspace "Checkout": mixed outcomes, one running run, two pinned.
import type { Json } from '../../harness.js';
import { fixture, ids } from '../index.js';
import { elapsedAtNow, liveRun, startedAtMs } from './live.js';
import { liveIds } from './live-data.js';

const scope = { kind: 'workspace', organizationId: ids.organization, workspaceId: ids.workspace };
const suites = {
  steady: { id: liveIds.suite, name: 'steady-1.2k' },
  smoke: { id: '5e000000-0000-4000-8000-000000000002', name: 'smoke-catalog' },
  ramp: { id: '5e000000-0000-4000-8000-000000000003', name: 'ramp-until-break' },
  soak: { id: '5e000000-0000-4000-8000-000000000004', name: 'soak-27m' },
  crawl: { id: '5e000000-0000-4000-8000-000000000005', name: 'catalog-crawl' },
} as const;
type SuiteKey = keyof typeof suites;

interface Spec {
  short: string;
  suite: SuiteKey;
  rev: number;
  startedAt: string;
  state: 'finished' | 'cancelled' | 'active';
  outcome: 'passed' | 'failed' | 'pending' | 'inconclusive';
  length: number;
  rps: number;
  p95: number;
  failed: number;
  pinned?: boolean;
  note?: string;
}
/** Newest first. Times are UTC and before the fixed clock. */
export const specs: Spec[] = [
  {
    short: 'a7f2',
    suite: 'steady',
    rev: 4,
    startedAt: new Date(startedAtMs).toISOString(),
    state: 'active',
    outcome: 'pending',
    length: elapsedAtNow * 1000,
    rps: 1201,
    p95: 186,
    failed: 0.0004,
  },
  {
    short: '7d49',
    suite: 'smoke',
    rev: 3,
    startedAt: '2026-11-07T22:28:00.000Z',
    state: 'finished',
    outcome: 'passed',
    length: 60_000,
    rps: 25,
    p95: 101,
    failed: 0.0005,
  },
  {
    short: 'b089',
    suite: 'steady',
    rev: 4,
    startedAt: '2026-11-07T21:04:00.000Z',
    state: 'finished',
    outcome: 'passed',
    length: 600_000,
    rps: 1198,
    p95: 188,
    failed: 0.0004,
    pinned: true,
  },
  {
    short: '405b',
    suite: 'steady',
    rev: 4,
    startedAt: '2026-11-07T20:16:00.000Z',
    state: 'finished',
    outcome: 'failed',
    length: 600_000,
    rps: 1187,
    p95: 197,
    failed: 0.0006,
  },
  {
    short: 'e118',
    suite: 'ramp',
    rev: 2,
    startedAt: '2026-11-07T18:40:00.000Z',
    state: 'finished',
    outcome: 'passed',
    length: 840_000,
    rps: 1340,
    p95: 241,
    failed: 0.0007,
  },
  {
    short: '9c3a',
    suite: 'soak',
    rev: 1,
    startedAt: '2026-11-07T14:40:00.000Z',
    state: 'finished',
    outcome: 'passed',
    length: 1_620_000,
    rps: 560,
    p95: 152,
    failed: 0.0003,
  },
  {
    short: 'f61e',
    suite: 'steady',
    rev: 3,
    startedAt: '2026-11-06T21:06:00.000Z',
    state: 'cancelled',
    outcome: 'inconclusive',
    length: 252_000,
    rps: 1196,
    p95: 184,
    failed: 0.0004,
  },
  {
    short: 'c3d1',
    suite: 'crawl',
    rev: 2,
    startedAt: '2026-11-06T14:20:00.000Z',
    state: 'finished',
    outcome: 'passed',
    length: 960_000,
    rps: 900,
    p95: 312,
    failed: 0.0008,
    pinned: true,
  },
];

const fillerSuites: SuiteKey[] = ['steady', 'smoke', 'ramp', 'crawl', 'soak'];
/** Sixteen older runs so the page really holds all 24 (the contract pages by 100, never short of the count). */
for (let i = 0; i < 16; i++) {
  const hex = (0x3a10 + i * 37).toString(16).padStart(4, '0');
  const suite = fillerSuites[i % 5]!;
  specs.push({
    short: hex,
    suite,
    rev: 1 + (i % 3),
    startedAt: new Date(Date.parse('2026-11-06T12:00:00.000Z') - i * 5_400_000).toISOString(),
    state: 'finished',
    outcome: i === 6 ? 'failed' : 'passed',
    length: [60_000, 600_000, 840_000, 960_000, 1_620_000][i % 5]!,
    rps: 400 + ((i * 97) % 900),
    p95: 90 + ((i * 53) % 220),
    failed: ((i * 7) % 9) / 10_000,
    ...(i === 3 ? { pinned: true } : {}),
  });
}

const uuid = (short: string, tail: string) => `${short}0000-0000-4000-8000-${tail}`;
export const runId = (short: string) => uuid(short, '000000000001');
const attempt = (short: string) => uuid(short, '0000000000a1');

export function runOf(spec: Spec, patch: Record<string, Json> = {}): Json {
  if (spec.short === 'a7f2') return { ...liveRun(), ...patch };
  const started = Date.parse(spec.startedAt);
  const ended = spec.state === 'active' ? null : new Date(started + spec.length).toISOString();
  return {
    ...fixture('run'),
    id: runId(spec.short),
    suiteId: suites[spec.suite].id,
    revisionId: uuid('51e0', `0000000000e${spec.rev}`),
    revisionDigest: String(spec.rev).repeat(64),
    requestedAt: new Date(started - 5000).toISOString(),
    startedAt: spec.startedAt,
    finishedAt: ended,
    state: spec.state,
    outcome: spec.outcome,
    validationStatus: 'passed',
    activeAttemptId: attempt(spec.short),
    requestedBy: 'you',
    ...(spec.state === 'cancelled' ? { cancellationRequested: true, reason: 'cancelled' } : {}),
    engine: { ...fixture<{ engine: object }>('run').engine, profileId: 'k6' } as Json,
    ...(spec.pinned ? { pinned: true, pinnedAt: '2026-11-07T22:00:00.000Z' } : {}),
    ...(spec.note ? { note: spec.note } : {}),
    ...patch,
  };
}

function summaryOf(spec: Spec): Json {
  const samples = Math.round(spec.rps * (spec.length / 1000));
  const failures = Math.round(samples * spec.failed);
  const preview = Array.from({ length: 12 }, (_, i) => ({
    offsetSeconds: Math.round((spec.length / 1000 / 12) * i) + i,
    p95Ms: Math.round(spec.p95 * (0.6 + 0.4 * Math.min(1, i / 3) + Math.sin(i * 1.7 + spec.rev) * 0.04)),
    gapBefore: false,
  }));
  return {
    runId: runId(spec.short),
    attemptId: attempt(spec.short),
    availability: 'ready',
    source: {
      generation: 1,
      manifestDigest: 'a'.repeat(64),
      numericArtifactId: uuid(spec.short, '0000000000b1'),
      numericSha256: 'b'.repeat(64),
      numericVersion: 5,
      measurementSourceTimeMs: 1000,
      coverage: { complete: true, latePoints: 0, markerDelayDroppedBuckets: 0 },
    },
    testDurationMs: spec.length,
    requestCount: samples,
    requestsPerSecond: samples / (spec.length / 1000),
    httpFailures: failures,
    httpSamples: samples,
    httpFailureRatio: failures / samples,
    httpP95: { source: 'histogram-estimate', scale: 0, estimate: spec.p95, lower: spec.p95, upper: spec.p95 },
    httpP95Preview: preview,
    publishedArtifactBytes: 1_500_000,
    retainedLogicalBytes: 3_000_000,
    metadataAllowanceBytes: 65_536,
  };
}

export const counts = { all: 24, running: 1, passed: 20, failed: 2, cancelled: 1, pinned: 3, matched: 24, before: 0 };

export interface ListOptions {
  rows?: Spec[];
  patch?: (spec: Spec) => Record<string, Json>;
  counts?: Partial<typeof counts>;
}
export function runPage(options: ListOptions = {}): Json {
  const rows = options.rows ?? specs;
  return {
    workspaceName: 'checkout-team',
    scope,
    items: rows.map((spec) => runOf(spec, options.patch?.(spec))),
    nextCursor: null,
    summaries: rows.map(summaryOf),
    contexts: rows.map((spec) => ({
      runId: runId(spec.short),
      suiteId: suites[spec.suite].id,
      revisionId: uuid('51e0', `0000000000e${spec.rev}`),
      suiteName: suites[spec.suite].name,
      revisionOrdinal: spec.rev,
    })),
    counts: { ...counts, ...options.counts },
  } as Json;
}

export const suitePage: Json = {
  scope,
  items: Object.values(suites).map((suite) => ({
    ...fixture('suite'),
    id: suite.id,
    name: suite.name,
    currentRevisionId: null,
  })),
  nextCursor: null,
  summaries: Object.values(suites).map((suite) => ({
    suiteId: suite.id,
    engineId: null,
    group: 'no_runs',
    latestRun: null,
  })),
} as Json;
