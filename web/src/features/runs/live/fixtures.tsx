import { render } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { LiveMetricSnapshot, Run, Suite, SuiteRevision } from '@beetle/contracts/api';
import { ApiContext } from '../../../app/api.js';
import { createQueryClient } from '../../../app/queries.js';
import { ids, json, testClient } from '../../../app/test-fixtures.js';
import type { RequestRecord } from '../../../app/test-fixtures.js';
import { frame as baseFrame, latest } from '../live-metrics/fixtures.js';
import { emptyEvents, revision as baseRevision, run, runId, suiteId, revisionId } from '../test-fixtures.js';
import { LiveRunView } from './index.js';
import type { LiveRunViewProps } from './index.js';

export { ids, json, runId, suiteId, revisionId };
export const startedAt = '2026-11-10T23:35:00.000Z';

/** Plan: 1 m ramp to 1,200/s, 8 m steady, 1 m drain; p95 < 250 ms, failed rate < 1 %. */
export const config = {
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

export function liveRun(patch: Partial<Run> = {}): Run {
  return { ...run(), state: 'active', startedAt, ...patch };
}
export function revision(): SuiteRevision {
  return { ...baseRevision(), ordinal: 4, config };
}
export function suite(): Suite {
  return {
    id: suiteId,
    scope: run().scope,
    version: 1,
    name: 'steady-1.2k',
    folderId: ids.folder,
    currentRevisionId: revisionId,
  };
}

type Series = LiveMetricSnapshot['series'][number];
const trend = (count: number, p50: number, p95: number, p99: number): Series['total'] => {
  const p = (estimate: number) => ({
    source: 'histogram-estimate' as const,
    scale: 0,
    estimate,
    lower: estimate,
    upper: estimate,
  });
  return {
    kind: 'trend',
    count,
    sum: count * p50,
    min: 1,
    max: p99,
    mean: p50,
    percentiles: { p50: p(p50), p90: p(p95), p95: p(p95), p99: p(p99) },
  };
};
const tags = (request: string) => ({ phase: 'execute' as const, request });

/** One live window: 1 s wide, two endpoints, VUs, and target samples. */
export function liveFrame(current: Run, sequence = 1, options: { omitted?: number; target?: boolean } = {}) {
  const now = Date.now();
  const series: Series[] = [
    {
      ordinal: 0,
      metric: 'http_req_duration',
      kind: 'trend',
      scope: 'execute',
      tags: tags('r0'),
      unit: 'ms',
      total: trend(900, 57, 236, 281),
    },
    {
      ordinal: 1,
      metric: 'http_req_failed',
      kind: 'rate',
      scope: 'execute',
      tags: tags('r0'),
      unit: 'ratio',
      total: { kind: 'rate', numerator: 2, sampleCount: 900, ratio: 2 / 900 },
    },
    {
      ordinal: 2,
      metric: 'http_req_duration',
      kind: 'trend',
      scope: 'execute',
      tags: tags('r1'),
      unit: 'ms',
      total: trend(300, 4, 12, 20),
    },
    {
      ordinal: 3,
      metric: 'http_req_failed',
      kind: 'rate',
      scope: 'execute',
      tags: tags('r1'),
      unit: 'ratio',
      total: { kind: 'rate', numerator: 0, sampleCount: 300, ratio: 0 },
    },
    {
      ordinal: 4,
      metric: 'vus',
      kind: 'gauge',
      scope: 'engine',
      tags: {},
      unit: 'count',
      total: { kind: 'gauge', latest: 142, sourceTimeMs: now, min: 140, max: 150 },
    },
    {
      ordinal: 5,
      metric: 'vus_max',
      kind: 'gauge',
      scope: 'engine',
      tags: {},
      unit: 'count',
      total: { kind: 'gauge', latest: 300, sourceTimeMs: now, min: 300, max: 300 },
    },
  ];
  const values = {
    rss: 567,
    heapAlloc: null,
    heapInuse: null,
    usedHeapSize: 399,
    totalHeapSize: 500,
    cpuPercent: 64,
    systemCpuPercent: 38,
    'eventLoopDelay.mean': 9.5,
    'eventLoopDelay.p99': 22,
    'eventLoopDelay.max': 32.4,
    activeHandles: 168,
    goroutines: null,
  };
  const snapshot = baseFrame({
    scope: {
      organizationId: current.scope.organizationId,
      workspaceId: current.scope.workspaceId,
      attemptId: current.activeAttemptId,
      generation: 1,
    },
    subset: {
      selected: series.map(({ unit: _unit, total: _total, ...row }) => ({ ...row, ordinal: row.ordinal })),
      excludedSeries: 3,
    },
    publishedSequence: sequence,
    sourceSequence: sequence,
    capturedAtMs: now,
    publishedAtMs: now,
    startTimeMs: now - 1000,
    endTimeMs: now,
    series,
    ...(options.target === false
      ? {}
      : {
          target: {
            scope: 'target-reported' as const,
            intervalMs: 1000,
            omittedSamples: options.omitted ?? 0,
            samples: [
              { observedAtMs: now - 1000, phase: 'during' as const, status: 'ready' as const, values },
              {
                observedAtMs: now - 10,
                phase: 'during' as const,
                status: 'ready' as const,
                values: { ...values, rss: 570 },
              },
            ],
          },
        }),
  });
  return { ...latest(snapshot, performance.now(), now), fingerprint: sequence.toString(16).padStart(64, '0') };
}

export function routesFor(current: () => Run, extra?: (request: RequestRecord) => Response | undefined) {
  return testClient((request) => {
    const special = extra?.(request);
    if (special) return special;
    if (request.path.endsWith(`/revisions/${revisionId}`)) return json(revision());
    if (request.path.endsWith(`/suites/${suiteId}`)) return json(suite());
    if (/\/revisions(\?|$)/.test(request.path)) {
      const { config: _config, inputManifest: _manifest, ...summary } = revision();
      return json({
        scope: summary.scope,
        suiteId,
        items: [{ ...summary, savedBy: 'Meera', runCount: 3 }],
        nextCursor: null,
      });
    }
    if (request.path.endsWith('/auth/session'))
      return json({ scope: 'local-admin', expiresAt: '2026-11-20T12:00:00.000Z', csrfToken: 'B'.repeat(43) });
    if (request.path.includes('/events?')) return json(emptyEvents(current()));
    throw new Error(`Unexpected synthetic route ${request.path}`);
  });
}

export function mountLive(
  client: ReturnType<typeof testClient>['client'],
  props: Partial<LiveRunViewProps> & { run: Run },
) {
  const queryClient = createQueryClient();
  const ui = (next: Partial<LiveRunViewProps> & { run: Run }) => (
    <MemoryRouter>
      <ApiContext.Provider value={client}>
        <QueryClientProvider client={queryClient}>
          <LiveRunView scope={next.run.scope} runId={next.run.id} showResult={() => undefined} {...next} />
        </QueryClientProvider>
      </ApiContext.Provider>
    </MemoryRouter>
  );
  const view = render(ui(props));
  return { ...view, queryClient, update: (next: Partial<LiveRunViewProps> & { run: Run }) => view.rerender(ui(next)) };
}
