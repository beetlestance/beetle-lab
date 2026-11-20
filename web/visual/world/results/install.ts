// Answers every call the Run result page makes for one case, plus the compare picker list.
import type { Api, Json } from '../../harness.js';
import { fixture, signedIn } from '../index.js';
import type { CaseOptions, ResultCase } from './data.js';
import { buildCase, describe, scope } from './data.js';
import { rng } from './profiles.js';

const base = { version: '1.0', organizationId: scope.organizationId, workspaceId: scope.workspaceId, generation: 1 };

function events(c: ResultCase): Json[] {
  const at = (s: number) => new Date(c.timing.startedMs - 20_000 + s * 1000).toISOString();
  const end = Math.round(c.timing.ranMs / 1000) + 20;
  const wrapper = (seq: number, kind: string, s: number, payload: Json, phase = 'execute'): Json => ({
    ...base,
    attemptId: c.ids.attempt,
    seq,
    kind,
    phase,
    observedAt: at(s),
    payload,
    source: 'wrapper',
    wrapperSeq: seq,
  });
  const agent = (seq: number, kind: string, s: number, payload: Json): Json => ({
    ...base,
    attemptId: c.ids.attempt,
    seq,
    kind,
    phase: 'execute',
    observedAt: at(s),
    payload,
    source: 'agent',
  });
  const budget = { phase: 'validate', timeoutMs: 30_000, workUnits: 4, outputBytes: 4096 };
  return [
    wrapper(1, 'phase.started', 0, { budget }, 'validate'),
    wrapper(2, 'phase.finished', 3, { completedUnits: 4, outputBytes: 812 }, 'validate'),
    agent(3, 'admitted', 4, {
      budget: { cpuMillis: 2000, memoryBytes: 8589934592, pids: 512, timeoutMs: 1_080_000, outputBytes: 1073741824 },
    }),
    agent(4, 'runtime.started', 6, { runtimeId: 'k6-local' }),
    wrapper(5, 'phase.started', 20, { budget: { ...budget, phase: 'execute', workUnits: 100 } }),
    wrapper(6, 'progress', end / 2, { completedUnits: 50, totalUnits: 100, heartbeat: false, usefulProgress: true }),
    c.variant === 'cancelled'
      ? agent(7, 'cancellation.requested', end - 2, { requestedAt: at(end - 2) })
      : wrapper(7, 'phase.finished', end, { completedUnits: 100, outputBytes: 1_048_576 }),
    agent(8, 'resource.summary', end + 2, {
      scope: 'container',
      cpuMillis: 412_000,
      peakMemoryBytes: c.variant === 'oom' ? 4294967296 : 1_932_735_283,
      peakPids: 58,
      outputBytes: c.variant === 'output-full' ? 2147483648 : 1_048_576,
      enforcedControls: ['cpu', 'memory', 'pids'],
      source: 'docker-stats',
      lastSampleAt: at(end + 1),
      samples: 118,
      missedSamples: 0,
      reason: null,
    }),
    agent(9, 'runtime.exited', end + 3, {
      exitCode: c.variant === 'passed' ? 0 : 137,
      oomKilled: c.variant === 'oom',
      observedAt: at(end + 3),
    }),
  ];
}

export function eventPage(c: ResultCase, after = 0, limit = 100): Json {
  const all = events(c);
  const items = all.slice(after, after + limit);
  const cursor = JSON.stringify({
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    runId: c.ids.run,
    attemptId: c.ids.attempt,
    generation: 1,
    afterSeq: after + items.length,
  });
  const encoded = Buffer.from(cursor).toString('base64url');
  return {
    id: c.ids.run,
    scope,
    activeAttemptId: c.ids.attempt,
    generation: 1,
    afterSeq: after,
    durableThrough: all.length,
    coverage: 'contiguous',
    blockedReason: null,
    retainedStartSeq: null,
    items,
    resumeCursor: encoded,
    nextCursor: after + items.length < all.length ? encoded : null,
  };
}

const notFound = {
  status: 404,
  body: {
    ...fixture<Record<string, Json>>('safe-error'),
    code: 'not_found',
    message: 'Resource not found',
    fields: [],
  },
};

/** Previous runs shown by the compare picker: ids, outcome, p95 and when. */
const earlier: [string, string, string, number, number | null, string][] = [
  ['b9e4', 'passed', '2026-11-05T18:12:00.000Z', 600_000, 186, 'revision 2'],
  ['b7a2', 'failed', '2026-11-04T07:41:00.000Z', 600_000, 412, 'revision 2'],
  ['b31f', 'passed', '2026-11-02T10:00:00.000Z', 600_000, 171, 'revision 1'],
  ['b20c', 'passed', '2026-10-31T10:00:00.000Z', 600_000, 168, 'revision 1'],
  ['b1d8', 'cancelled', '2026-10-29T03:12:00.000Z', 192_000, null, 'revision 1'],
  ['b0a5', 'passed', '2026-10-25T10:00:00.000Z', 600_000, 203, 'revision 1'],
];

export function candidates(c: ResultCase): Json {
  const next = rng(5);
  const items: Json[] = [];
  const summaries: Json[] = [];
  const contexts: Json[] = [];
  earlier.forEach(([short, outcome, when, ranMs, p95], i) => {
    const id = `${short}0000-0000-4000-8000-0000000000d${i}`;
    const stopped = outcome === 'cancelled';
    const rps = Math.round(c.profile.rps * (0.9 + next() * 0.2));
    const count = rps * (ranMs / 1000);
    const run = {
      ...c.run,
      id,
      revisionId: i < 2 ? c.ids.revision : '7b200000-0000-4000-8000-0000000000e0',
      activeAttemptId: `${short}a000-0000-4000-8000-0000000000a${i}`,
      requestedAt: when,
      cancellationRequested: stopped,
      state: stopped ? 'cancelled' : 'finished',
      outcome: stopped ? 'inconclusive' : outcome,
      validationStatus: stopped ? 'pending' : 'passed',
      reason: stopped ? 'cancelled' : null,
      note: undefined,
      noteVersion: undefined,
      pinned: undefined,
    };
    items.push(JSON.parse(JSON.stringify(run)) as Json);
    contexts.push({
      runId: id,
      suiteId: c.ids.suite,
      revisionId: i < 2 ? c.ids.revision : '7b200000-0000-4000-8000-0000000000e0',
      suiteName: c.profile.suiteName,
      revisionOrdinal: i < 2 ? 2 : 1,
    });
    summaries.push({
      ...(c.summary as object),
      runId: id,
      attemptId: `${short}a000-0000-4000-8000-0000000000a${i}`,
      testDurationMs: ranMs,
      requestCount: count,
      requestsPerSecond: rps,
      httpSamples: count,
      httpFailures: Math.round(count * c.profile.failRatio),
      httpFailureRatio: Math.round(count * c.profile.failRatio) / count,
      httpP95:
        p95 === null ? null : { source: 'histogram-estimate', scale: 4, estimate: p95, lower: p95 - 2, upper: p95 + 2 },
    } as Json);
  });
  return { scope, items, summaries, contexts, nextCursor: null };
}

/** Handlers for the whole Run result page. `ready: false` leaves the result unpublished. */
export function installResult(api: Api, c: ResultCase, options: { pending?: boolean } = {}): Api {
  const pending = options.pending === true;
  const owner = { id: c.ids.run, scope, activeAttemptId: c.ids.attempt };
  signedIn(api)
    .on('getRun', c.run as Json)
    .on('getRunResult', { ...owner, result: pending ? null : c.result })
    .on('listRuns', (call) =>
      call.query.has('runIdPrefix')
        ? { scope, items: [c.run as Json], summaries: [c.summary], nextCursor: null }
        : candidates(c),
    )
    .on('getSuite', c.suite)
    .on('getSuiteRevision', c.revision)
    .on('getRunMetricOverview', c.overview)
    .on('getRunChartHistory', c.chart)
    .on('getRunStoppedHistory', notFound)
    .on('listRunEvents', (call) => {
      const cursor = call.query.get('cursor');
      const after = cursor
        ? (JSON.parse(Buffer.from(cursor, 'base64url').toString()) as { afterSeq: number }).afterSeq
        : 0;
      return eventPage(c, after, Number(call.query.get('limit') ?? 100));
    })
    .on('getRunLatencyAttribution', {
      ...fixture<Record<string, Json>>('run-latency-attribution'),
      id: c.ids.run,
      attemptId: c.ids.attempt,
      rise: {
        startTimeMs: c.timing.startedMs + 60_000,
        endTimeMs: c.timing.startedMs + 90_000,
        windows: 8,
        baselineP95Ms: 140,
        peakP95Ms: c.profile.p95 * 1.2,
        endpoint: { request: 'r0', share: 0.64, peakP95Ms: c.profile.endpoints[0]!.p95 * 1.4 },
      },
    })
    .on('listRunArtifacts', {
      id: c.ids.run,
      scope,
      attemptId: c.ids.attempt,
      generation: 1,
      availability: 'ready',
      manifestDigest: 'a'.repeat(64),
      items: c.artifacts.map(describe),
      nextCursor: null,
    });
  api.route(/\/artifacts\/[^/]+\/content$/, async (route) => {
    const id = new URL(route.request().url()).pathname.split('/').at(-2);
    const found = c.artifacts.find((a) => a.artifactId === id);
    if (!found) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ status: 200, contentType: 'application/octet-stream', body: found.body });
  });
  return api;
}

export const resultPath = (runId: string) =>
  `/organizations/${scope.organizationId}/workspaces/${scope.workspaceId}/runs/${runId}`;
export { buildCase };
export type { CaseOptions };
