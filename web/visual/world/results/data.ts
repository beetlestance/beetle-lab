// One finished run of the Run result boards: the run, its saved revision, engine result,
// measurements and published artifacts, all satisfying the API contract.
import type { Json } from '../../harness.js';
import { fixture, ids as shared } from '../index.js';
import type { Profile } from './profiles.js';
import { catalog, sha256, steady, steadyBase } from './profiles.js';
import { artifactBodies } from './texts.js';
import type { Timing } from './series.js';
import { chartHistory, overview, requestsOf, source, targetReport } from './series.js';

export type Variant = 'baseline' | 'passed' | 'failed' | 'cancelled' | 'oom' | 'output-full' | 'incomplete';
export interface CaseOptions {
  readonly variant: Variant;
  readonly note?: string;
  readonly pinned?: boolean;
}
export interface Artifact {
  readonly artifactId: string;
  readonly kind: string;
  readonly relativePath: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly sealedAt: string;
  readonly body: string;
}
export interface CaseIds {
  run: string;
  attempt: string;
  suite: string;
  revision: string;
}
export interface ResultCase {
  readonly variant: Variant;
  readonly profile: Profile;
  readonly run: Record<string, Json>;
  readonly suite: Json;
  readonly revision: Json;
  readonly summary: Json;
  readonly result: Json;
  readonly overview: Json;
  readonly chart: Json;
  readonly artifacts: readonly Artifact[];
  readonly timing: Timing;
  readonly ids: CaseIds;
}

export const scope = { kind: 'workspace', organizationId: shared.organization, workspaceId: shared.workspace };
const stoppedAt: Record<Variant, number> = {
  baseline: 0,
  passed: 0,
  failed: 0,
  cancelled: 252_000,
  oom: 402_000,
  'output-full': 430_000,
  incomplete: 0,
};
const runIds: Record<Variant, string> = {
  baseline: 'b0890000-0000-4000-8000-0000000000b0',
  passed: 'c3d10000-0000-4000-8000-0000000000c1',
  failed: '405b0000-0000-4000-8000-0000000000b1',
  cancelled: 'f61e0000-0000-4000-8000-0000000000b2',
  oom: '405b0000-0000-4000-8000-0000000000b3',
  'output-full': '405b0000-0000-4000-8000-0000000000b4',
  incomplete: '405b0000-0000-4000-8000-0000000000b5',
};
const requestedAt: Record<Variant, string> = {
  baseline: '2026-11-06T19:30:00.000Z',
  passed: '2026-11-06T14:20:00.000Z',
  failed: '2026-11-07T20:16:00.000Z',
  cancelled: '2026-11-06T21:06:00.000Z',
  oom: '2026-11-07T20:16:00.000Z',
  'output-full': '2026-11-07T20:16:00.000Z',
  incomplete: '2026-11-07T20:16:00.000Z',
};
const reasons: Partial<Record<Variant, string>> = {
  cancelled: 'cancelled',
  oom: 'memory_limit',
  'output-full': 'output_limit',
  incomplete: 'artifact_incomplete',
};

const states: Record<Variant, [string, string, string]> = {
  baseline: ['finished', 'passed', 'passed'],
  passed: ['finished', 'passed', 'passed'],
  failed: ['finished', 'failed', 'passed'],
  cancelled: ['cancelled', 'inconclusive', 'pending'],
  oom: ['errored', 'inconclusive', 'pending'],
  'output-full': ['errored', 'inconclusive', 'pending'],
  incomplete: ['errored', 'inconclusive', 'pending'],
};
function runFields(v: Variant, p: Profile, ranMs: number) {
  const [state, outcome, validationStatus] = states[v];
  const start = Date.parse(requestedAt[v]) + 5000;
  return {
    state,
    outcome,
    validationStatus,
    cancellationRequested: v === 'cancelled',
    reason: reasons[v] ?? null,
    startedAt: new Date(start).toISOString(),
    finishedAt: new Date(start + ranMs + 16_000).toISOString(),
    requestedBy: 'Meera',
    budget: {
      cpuMillis: 2000,
      memoryBytes: v === 'oom' ? 4294967296 : 8589934592,
      pids: 512,
      timeoutMs: p.durationMs + 120_000,
      outputBytes: v === 'output-full' ? 2147483648 : 1073741824,
    },
  };
}

function buildRevision(p: Profile, ids: CaseIds): Json {
  const base = fixture<{ config: Record<string, Json> }>('suite-revision');
  return {
    ...base,
    id: ids.revision,
    suiteId: ids.suite,
    ordinal: p.ordinal,
    digest: p.digest,
    savedAt: p.savedAt,
    message: p.message,
    savedBy: 'Meera',
    config: {
      ...base.config,
      target: p.target,
      targetSampling: { intervalMs: 5000 },
      requests: p.endpoints.map((e, i) => ({
        id: `request-${i}`,
        name: e.name,
        method: e.method,
        path: e.path,
        query: {},
        headers: {},
        assertions: [],
      })),
      loadPlan: {
        version: 1,
        scenarios: [
          {
            id: 'main',
            name: 'Main',
            executor: 'ramping-arrival-rate',
            startRate: 0,
            timeUnit: '1s',
            preAllocatedVUs: 100,
            maxVUs: p.vusMax,
            stages: [
              { duration: `${p.rampMs / 1000}s`, target: p.rps },
              { duration: `${(p.durationMs - p.rampMs) / 1000}s`, target: p.rps },
            ],
            startTime: '0s',
            gracefulStop: '0s',
          },
        ],
        slos: p.slos.map(({ id, metric, stat, operator, value }) => ({ id, metric, stat, operator, value })),
      },
    },
  };
}

function history(p: Profile, ids: CaseIds, t: Timing, ready: boolean): Json {
  const common = { runId: ids.run, attemptId: ids.attempt, metadataAllowanceBytes: 65536 };
  if (!ready)
    return {
      ...common,
      availability: 'not_recorded',
      source: null,
      testDurationMs: null,
      requestCount: null,
      requestsPerSecond: null,
      httpFailures: null,
      httpSamples: null,
      httpFailureRatio: null,
      httpP95: null,
      publishedArtifactBytes: 2048,
      retainedLogicalBytes: 67584,
    };
  const total = requestsOf(p, t.ranMs);
  const o = overview(p, t, { run: ids.run, attempt: ids.attempt, scope }) as unknown as {
    latency: { percentiles: { p95: Json } };
  };
  return {
    ...common,
    availability: 'ready',
    source: source(p, t),
    testDurationMs: t.ranMs,
    requestCount: total,
    requestsPerSecond: p.rps,
    httpFailures: Math.round(total * p.failRatio),
    httpSamples: total,
    httpFailureRatio: Math.round(total * p.failRatio) / total,
    httpP95: o.latency.percentiles.p95,
    publishedArtifactBytes: 1_572_864,
    retainedLogicalBytes: 1_638_400,
  };
}

const kinds: [string, string][] = [
  ['standalone-k6-script', 'script.js'],
  ['performance-report', 'performance-report.txt'],
  ['metrics-csv', 'metrics.csv'],
  ['numeric-final', 'numeric-final.json'],
  ['k6-diagnostics', 'k6-diagnostics.json'],
  ['k6-warnings', 'k6-warnings.json'],
  ['target-runtime', 'target-runtime.json'],
];
function buildArtifacts(p: Profile, v: Variant, t: Timing, ids: CaseIds, target: Json): Artifact[] {
  const bodies = artifactBodies({ profile: p, variant: v, timing: t, ids, target, scope });
  return kinds
    .filter(([kind]) => !(v === 'incomplete' && (kind === 'target-runtime' || kind === 'metrics-csv')))
    .map(([kind, relativePath], i) => {
      const body = bodies[kind]!;
      return {
        artifactId: `a7f0000${i}-0000-4000-8000-00000000000${i}`,
        kind,
        relativePath,
        bytes: Buffer.byteLength(body),
        sha256: sha256(body),
        sealedAt: new Date(t.startedMs + t.ranMs + 12_000).toISOString(),
        body,
      };
    });
}

/** The inventory entry without the stored bytes. */
export function describe(a: Artifact) {
  return {
    artifactId: a.artifactId,
    kind: a.kind,
    relativePath: a.relativePath,
    bytes: a.bytes,
    sha256: a.sha256,
    sealedAt: a.sealedAt,
  };
}

function execution(v: Variant, stopped: string): Json {
  if (v === 'passed' || v === 'baseline') return { status: 'completed', exitCode: 0, stoppedAt: stopped };
  if (v === 'failed') return { status: 'completed', exitCode: 99, stoppedAt: stopped };
  if (v === 'incomplete') return { status: 'completed', exitCode: 0, stoppedAt: stopped };
  if (v === 'cancelled') return { status: 'cancelled', reason: 'cancelled', exitCode: null, stoppedAt: stopped };
  return { status: 'error', reason: reasons[v]!, exitCode: 137, stoppedAt: stopped };
}

function buildResult(v: Variant, p: Profile, t: Timing, ids: CaseIds, artifacts: Artifact[]): Json {
  const [, outcome] = states[v];
  const passed = outcome === 'passed';
  const complete = outcome !== 'inconclusive';
  const stopped = new Date(t.startedMs + t.ranMs + 14_000).toISOString();
  return {
    protocolVersion: '1.0',
    organizationId: shared.organization,
    workspaceId: shared.workspace,
    attemptId: ids.attempt,
    generation: 1,
    schemaId: 'https://beetle-lab.dev/contracts/runner/v1/engine-result',
    engineId: 'k6',
    mode: 'ordinary',
    execution: execution(v, stopped),
    outcome,
    requiredAssertions: {
      required: 6,
      passed: passed ? 6 : complete ? 5 : 4,
      failed: outcome === 'failed' ? 1 : 0,
      unknown: complete ? 0 : 2,
    },
    thresholds: p.slos.map((s) => ({
      id: s.id,
      purpose: 'slo',
      passed: s.operator === '<' ? s.reading < s.value : s.reading > s.value,
      reading: { source: 'native-summary', metric: s.metric, stat: s.stat, value: s.reading },
    })),
    ...(v === 'incomplete'
      ? {
          nativeOverview: {
            summarySha256: 'd'.repeat(64),
            durationMs: t.ranMs,
            requests: requestsOf(p, t.ranMs),
            failureRatio: p.failRatio,
            checkPassRatio: p.checkRatio,
            droppedIterations: 0,
            p50Ms: p.p50,
            p95Ms: p.p95,
            p99Ms: p.p99,
          },
        }
      : {}),
    completeness: complete ? 'complete' : 'partial',
    artifacts: artifacts.map(describe),
    seal: { sha256: 'e'.repeat(64), sealedAt: stopped },
  };
}

/** What an incomplete run's overview and chart reads return: nothing was recorded. */
const missingOverview = {
  availability: 'not_recorded',
  source: null,
  testDurationMs: null,
  requestCount: null,
  requestsPerSecond: null,
  failure: null,
  latency: null,
  checks: null,
  droppedIterations: null,
  endpoints: [],
};
const missingChart = {
  source: null,
  windows: 0,
  points: [],
  observedPeakRequestsPerSecond: null,
  knownRequestWindows: 0,
  reason: 'not_recorded',
  meanVus: null,
  knownVusWindows: 0,
};

export function buildCase(options: CaseOptions): ResultCase {
  const v = options.variant;
  const p = v === 'passed' ? catalog : v === 'baseline' ? steadyBase : steady;
  const ids = {
    run: runIds[v],
    attempt: `a1b20000-0000-4000-8000-0000000000a${Object.keys(runIds).indexOf(v)}`,
    suite: p.suiteId,
    revision: `${p.key === 'catalog' ? '7b21' : '3fa8'}0000-0000-4000-8000-0000000000e1`,
  };
  const ranMs = stoppedAt[v] || p.durationMs;
  const timing = { startedMs: Date.parse(requestedAt[v]) + 5000, ranMs };
  const owner = { run: ids.run, attempt: ids.attempt, scope };
  const incomplete = v === 'incomplete';
  const target = targetReport(p, timing);
  const artifacts = buildArtifacts(p, v, timing, ids, target);
  const run: Record<string, Json> = {
    ...fixture('run'),
    id: ids.run,
    scope,
    suiteId: ids.suite,
    revisionId: ids.revision,
    revisionDigest: p.digest,
    requestedAt: requestedAt[v],
    activeAttemptId: ids.attempt,
    version: 3,
    engine: { id: 'k6', profileId: 'k6-local', imageDigest: `sha256:${'b'.repeat(64)}`, configVersion: 1 },
    ...runFields(v, p, ranMs),
    ...(options.note ? { note: options.note, noteVersion: 1, noteUpdatedAt: '2026-11-07T21:04:00.000Z' } : {}),
    ...(options.pinned ? { pinned: true, pinnedAt: '2026-11-07T21:10:00.000Z' } : {}),
  };
  const numeric = artifacts.find((a) => a.kind === 'numeric-final')!;
  /** The sealed numeric artifact is the one every measurement read points back to. */
  const bound = (value: unknown): Json => {
    const read = value as { source: Record<string, Json> | null };
    return (
      read.source
        ? { ...read, source: { ...read.source, numericArtifactId: numeric.artifactId, numericSha256: numeric.sha256 } }
        : read
    ) as Json;
  };
  return {
    variant: v,
    profile: p,
    run,
    suite: {
      ...fixture('suite'),
      id: ids.suite,
      name: p.suiteName,
      currentRevisionId: v === 'cancelled' ? '3fa90000-0000-4000-8000-0000000000e2' : ids.revision,
    },
    revision: buildRevision(p, ids),
    summary: bound(history(p, ids, timing, !incomplete)),
    result: buildResult(v, p, timing, ids, artifacts),
    overview: bound({ ...(overview(p, timing, owner) as object), ...(incomplete ? missingOverview : {}) }),
    chart: bound({ ...(chartHistory(p, timing, owner) as object), ...(incomplete ? missingChart : {}) }),
    artifacts,
    timing,
    ids,
  };
}
