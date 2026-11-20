// Recent runs shown by the overview boards: a7f2 running, then 7d49, b089, 405b, e118, f61e.
import { fixture } from '../index.js';
import type { Json } from '../../harness.js';
import { attemptId, revisionId, suiteIds, today, uuid } from './ids.js';

type Obj = Record<string, Json>;
export type RunState = 'queued' | 'dispatching' | 'active' | 'finalizing' | 'finished' | 'cancelled' | 'errored';
export type RunOutcome = 'pending' | 'passed' | 'failed' | 'inconclusive';

export interface RunSpec {
  readonly id: string;
  readonly suiteId: string;
  readonly requestedAt: string;
  readonly state: RunState;
  readonly outcome: RunOutcome;
  /** Recorded p95 in ms for finished runs. */
  readonly p95?: number;
}

export const liveStartedAt = '2026-11-07T23:35:10.000Z';

export const runSpecs: readonly RunSpec[] = [
  { id: uuid('a7f2', 1), suiteId: suiteIds.steady, requestedAt: today('23:35'), state: 'active', outcome: 'pending' },
  {
    id: uuid('7d49', 2),
    suiteId: suiteIds.smoke,
    requestedAt: today('22:28'),
    state: 'finished',
    outcome: 'passed',
    p95: 101,
  },
  {
    id: uuid('b089', 3),
    suiteId: suiteIds.steady,
    requestedAt: today('21:04'),
    state: 'finished',
    outcome: 'passed',
    p95: 188,
  },
  {
    id: uuid('405b', 4),
    suiteId: suiteIds.steady,
    requestedAt: today('20:16'),
    state: 'finished',
    outcome: 'failed',
    p95: 197,
  },
  {
    id: uuid('e118', 5),
    suiteId: suiteIds.ramp,
    requestedAt: today('18:40'),
    state: 'finished',
    outcome: 'passed',
    p95: 241,
  },
  {
    id: uuid('f61e', 6),
    suiteId: suiteIds.steady,
    requestedAt: today('15:50'),
    state: 'cancelled',
    outcome: 'inconclusive',
  },
  {
    id: uuid('5a0c', 7),
    suiteId: suiteIds.smoke,
    requestedAt: today('09:50'),
    state: 'finished',
    outcome: 'passed',
    p95: 96,
  },
  {
    id: uuid('3c1d', 8),
    suiteId: suiteIds.ramp,
    requestedAt: today('03:50'),
    state: 'finished',
    outcome: 'passed',
    p95: 255,
  },
];

/** One more finished run, for dashboards where nothing is running (the list still holds eight). */
export const olderRun: RunSpec = {
  id: uuid('b4e7', 9),
  suiteId: suiteIds.smoke,
  requestedAt: today('01:30'),
  state: 'finished',
  outcome: 'passed',
  p95: 99,
};

/** The contract Run for a spec, from the valid run fixture. */
export function runOf(spec: RunSpec): Obj {
  const active = spec.state === 'active';
  return {
    ...fixture('run'),
    id: spec.id,
    suiteId: spec.suiteId,
    revisionId,
    requestedAt: spec.requestedAt,
    state: spec.state,
    outcome: spec.outcome,
    activeAttemptId: active ? attemptId : uuid('0a00', 1),
    ...(active ? { startedAt: liveStartedAt, validationStatus: 'passed' } : {}),
    ...(spec.state === 'finished' ? { validationStatus: 'passed' } : {}),
    ...(spec.state === 'cancelled' ? { cancellationRequested: true, reason: 'cancelled' } : {}),
  };
}

/** The overview header of a spec (no workspace id). */
export function headerOf(spec: RunSpec): Obj {
  return {
    id: spec.id,
    suiteId: spec.suiteId,
    revisionId,
    requestedAt: spec.requestedAt,
    state: spec.state,
    outcome: spec.outcome,
  };
}

export function summaryOf(spec: RunSpec): Obj {
  const base = (fixture('run-page').summaries as Obj[])[0]!;
  const p95 = spec.p95;
  const attempt = spec.state === 'active' ? attemptId : uuid('0a00', 1);
  if (p95 === undefined) return { ...base, runId: spec.id, attemptId: attempt };
  const durationMs = 600_000;
  const requestCount = 720_000;
  const failures = 30;
  return {
    ...base,
    runId: spec.id,
    attemptId: attempt,
    availability: 'ready',
    source: {
      generation: 1,
      manifestDigest: 'a'.repeat(64),
      numericArtifactId: uuid('0b00', 1),
      numericSha256: 'b'.repeat(64),
      numericVersion: 5,
      measurementSourceTimeMs: Date.parse(spec.requestedAt) + durationMs,
      coverage: { complete: true, latePoints: 0, markerDelayDroppedBuckets: 0 },
    },
    testDurationMs: durationMs,
    requestCount,
    requestsPerSecond: requestCount / (durationMs / 1000),
    httpFailures: failures,
    httpSamples: requestCount,
    httpFailureRatio: failures / requestCount,
    httpP95: { source: 'histogram-estimate', scale: 0, estimate: p95, lower: p95, upper: p95 },
  };
}

export function runPage(specs: readonly RunSpec[]): Obj {
  return { ...fixture('run-page'), items: specs.map(runOf), summaries: specs.map(summaryOf), nextCursor: null };
}
