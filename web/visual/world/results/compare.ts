// The Compare screen: a snapshot of two finished runs plus every per-run read it makes.
import type { Api, Json } from '../../harness.js';
import { fixture, signedIn } from '../index.js';
import type { ResultCase } from './data.js';
import { buildCase, scope } from './data.js';

type Item = Record<string, Json>;

function limit(s: ResultCase['profile']['slos'][number]): Json {
  return { metric: s.metric, stat: s.stat, operator: s.operator, value: s.value };
}

function item(c: ResultCase): Item {
  const failed = c.variant === 'failed';
  const slos = c.profile.slos.map((s) => ({
    id: s.id,
    passed: s.operator === '<' ? s.reading < s.value : s.reading > s.value,
    reading: { source: 'native-summary', metric: s.metric, stat: s.stat, value: s.reading },
    limit: limit(s),
  }));
  const firstFailed = slos.find((s) => !s.passed);
  const base = fixture<{ items: Item[] }>('run-comparison').items[0]!;
  return {
    ...base,
    scenarioIntents: [
      {
        id: 'main',
        executor: 'ramping-arrival-rate',
        arrivalRate: { initial: 1, maximum: 1200, timeUnit: '1s' },
        vus: { initial: 100, maximum: 240 },
      },
    ],
    run: c.run as Json,
    result: {
      outcome: failed ? 'failed' : 'passed',
      completeness: 'complete',
      execution: { status: 'completed', exitCode: failed ? 99 : 0, stoppedAt: '2026-11-07T20:26:21Z' },
      requiredAssertions: (c.result as { requiredAssertions: Json }).requiredAssertions,
      ...(firstFailed
        ? { firstFailedSlo: { id: firstFailed.id, reading: firstFailed.reading, limit: firstFailed.limit } }
        : {}),
      slos,
      failedSloCount: slos.filter((s) => !s.passed).length,
      discoveryReached: null,
    },
    environment: { ...(base.environment as object), targetSampler: 'configured' },
    warnings: ['unknown_target_revision', 'unknown_contention'],
  } as Item;
}

export function snapshot(runs: readonly ResultCase[]): Json {
  return { scope, baselineRunId: runs[0]!.ids.run, metric: null, metricBinding: null, items: runs.map(item) };
}

const byRun =
  <T>(cases: readonly ResultCase[], pick: (c: ResultCase) => T) =>
  (call: { params: Record<string, string> }): T => {
    const found = cases.find((c) => c.ids.run === call.params.runId?.toLowerCase());
    if (!found) throw new Error(`No case for run ${call.params.runId}`);
    return pick(found);
  };

/** Reads for /runs/compare?runs=<baseline>,<other>. */
export function installComparison(api: Api, runs: readonly ResultCase[], options: { dropOverview?: string } = {}): Api {
  const pageOf = (c: ResultCase): Json => ({
    workspaceName: 'Checkout',
    scope,
    items: [c.run as Json],
    summaries: [c.summary],
    contexts: [
      {
        runId: c.ids.run,
        suiteId: c.ids.suite,
        revisionId: c.ids.revision,
        suiteName: c.profile.suiteName,
        revisionOrdinal: c.profile.ordinal,
      },
    ],
    nextCursor: null,
  });
  signedIn(api)
    .on('compareRuns', snapshot(runs))
    .on('listRuns', (call) => {
      const prefix = call.query.get('runIdPrefix');
      const found = runs.find((c) => prefix !== null && c.ids.run.startsWith(prefix));
      return found ? pageOf(found) : { workspaceName: 'Checkout', scope, items: [], summaries: [], nextCursor: null };
    })
    .on('getRunMetricOverview', (call) => {
      const found = runs.find((c) => c.ids.run === call.params.runId);
      if (found && found.ids.run === options.dropOverview)
        return {
          status: 500,
          body: {
            code: 'internal_error',
            message: 'Internal error',
            retryable: false,
            requestId: '00000000-0000-4000-8000-000000000010',
            fields: [],
          },
        };
      return byRun(runs, (c) => c.overview)(call);
    })
    .on(
      'getRunChartHistory',
      byRun(runs, (c) => c.chart),
    )
    .on(
      'getRunResult',
      byRun(runs, (c) => ({ id: c.ids.run, scope, activeAttemptId: c.ids.attempt, result: c.result })),
    )
    .on(
      'listRunMetricSeries',
      byRun(runs, (c) => ({
        id: c.ids.run,
        scope,
        attemptId: c.ids.attempt,
        generation: 1,
        availability: 'pending',
        manifestDigest: null,
        reason: null,
        windows: 0,
        totalSeries: 0,
        measurementSourceTimeMs: null,
        coverage: null,
        items: [],
        nextCursor: null,
      })),
    );
  api.route(/\/artifacts\/[^/]+\/content$/, async (route) => {
    const parts = new URL(route.request().url()).pathname.split('/');
    const run = parts[parts.indexOf('runs') + 1];
    const id = parts.at(-2);
    const found = runs.find((c) => c.ids.run === run)?.artifacts.find((a) => a.artifactId === id);
    if (!found) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ status: 200, contentType: 'application/octet-stream', body: found.body });
  });
  return api;
}

export const comparePath = (runs: readonly ResultCase[]) =>
  `/organizations/${scope.organizationId}/workspaces/${scope.workspaceId}/runs/compare?runs=${runs.map((c) => c.ids.run).join(',')}`;
export const compareEmptyPath = `/organizations/${scope.organizationId}/workspaces/${scope.workspaceId}/runs/compare`;
export { buildCase };
