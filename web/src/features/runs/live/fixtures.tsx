import { render } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { LiveMetricSnapshot, Run, Suite, SuiteRevision } from '@beetle/contracts/api';
import { ApiContext } from '../../../app/api.js';
import { createQueryClient } from '../../../app/queries.js';
import { SessionContext, writableSession } from '../../../app/session.js';
import type { SessionAccess } from '../../../app/session.js';
import { ids, json, testClient, readNamespace } from '../../../app/test-fixtures.js';
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
type Row = Omit<Series, 'ordinal' | 'unit' | 'total'>;
const endpoint = (request: string, metric: 'http_req_duration' | 'http_req_failed'): Row => ({
  metric,
  kind: metric === 'http_req_duration' ? 'trend' : 'rate',
  scope: 'execute',
  tags: tags(request),
});
const engine = (metric: 'vus' | 'vus_max'): Row => ({ metric, kind: 'gauge', scope: 'engine', tags: {} });
const rate = (numerator: number, sampleCount: number): Series['total'] => ({
  kind: 'rate',
  numerator,
  sampleCount,
  ratio: numerator / sampleCount,
});
const gauge = (latest: number, now: number, min: number, max: number): Series['total'] => ({
  kind: 'gauge',
  latest,
  sourceTimeMs: now,
  min,
  max,
});

/** r0 and r1 trends and failure rates, then VUs, in subset order. */
function liveSeries(now: number): { rows: (Row & { ordinal: number })[]; series: Series[] } {
  const parts: [Row, Series['unit'], Series['total']][] = [
    [endpoint('r0', 'http_req_duration'), 'ms', trend(900, 57, 236, 281)],
    [endpoint('r0', 'http_req_failed'), 'ratio', rate(2, 900)],
    [endpoint('r1', 'http_req_duration'), 'ms', trend(300, 4, 12, 20)],
    [endpoint('r1', 'http_req_failed'), 'ratio', rate(0, 300)],
    [engine('vus'), 'count', gauge(142, now, 140, 150)],
    [engine('vus_max'), 'count', gauge(300, now, 300, 300)],
  ];
  const rows = parts.map(([row], ordinal) => ({ ...row, ordinal }));
  const series = parts.map(([row, unit, total], ordinal) => ({ ...row, ordinal, unit, total }) as Series);
  return { rows, series };
}

const targetValues = {
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

/** Two ready target samples one second apart; RSS moves from 567 to 570. */
function targetBlock(now: number, omittedSamples: number) {
  const sample = (observedAtMs: number, rss: number) => ({
    observedAtMs,
    phase: 'during' as const,
    status: 'ready' as const,
    values: { ...targetValues, rss },
  });
  return {
    scope: 'target-reported' as const,
    intervalMs: 1000,
    omittedSamples,
    samples: [sample(now - 1000, 567), sample(now - 10, 570)],
  };
}

/** One live window: 1 s wide, two endpoints, VUs, and target samples. */
export function liveFrame(current: Run, sequence = 1, options: { omitted?: number; target?: boolean } = {}) {
  const now = Date.now();
  const { rows, series } = liveSeries(now);
  const snapshot = baseFrame({
    scope: {
      organizationId: current.scope.organizationId,
      workspaceId: current.scope.workspaceId,
      attemptId: current.activeAttemptId,
      generation: 1,
    },
    subset: { selected: rows, excludedSeries: 3 },
    publishedSequence: sequence,
    sourceSequence: sequence,
    capturedAtMs: now,
    publishedAtMs: now,
    startTimeMs: now - 1000,
    endTimeMs: now,
    series,
    ...(options.target === false ? {} : { target: targetBlock(now, options.omitted ?? 0) }),
  });
  return { ...latest(snapshot, performance.now(), now), fingerprint: sequence.toString(16).padStart(64, '0') };
}

/** The revision as a list summary: the page omits config and the input manifest. */
function revisionSummary() {
  const full = revision();
  return {
    id: full.id,
    scope: full.scope,
    suiteId: full.suiteId,
    ordinal: full.ordinal,
    engineId: full.engineId,
    configVersion: full.configVersion,
    digest: full.digest,
    preflightStatus: full.preflightStatus,
    savedBy: 'Meera',
    runCount: 3,
  };
}

export function routesFor(current: () => Run, extra?: (request: RequestRecord) => Response | undefined) {
  return testClient((request) => {
    const special = extra?.(request);
    if (special) return special;
    if (request.path.endsWith(`/revisions/${revisionId}`)) return json(revision());
    if (request.path.endsWith(`/suites/${suiteId}`)) return json(suite());
    if (/\/revisions(\?|$)/.test(request.path)) {
      const summary = revisionSummary();
      const id = (ordinal: number) =>
        ordinal === 4 ? summary.id : `88880000-0000-4000-8000-${String(ordinal).padStart(12, '0')}`;
      const items = [4, 3, 2, 1].map((ordinal) => ({
        ...summary,
        id: id(ordinal),
        ordinal,
        previousRevisionId: ordinal === 1 ? null : id(ordinal - 1),
        runCount: ordinal === 4 ? 3 : 0,
      }));
      return json({ scope: summary.scope, suiteId, items, nextCursor: null });
    }
    if (request.path.includes('/events?')) return json(emptyEvents(current()));
    if (
      request.path.endsWith('/organizations/' + current().scope.organizationId) ||
      request.path.endsWith('/workspaces/' + current().scope.workspaceId)
    )
      return readNamespace(request);
    throw new Error(`Unexpected synthetic route ${request.path}`);
  });
}

export function mountLive(
  client: ReturnType<typeof testClient>['client'],
  props: Partial<LiveRunViewProps> & { run: Run },
  session: SessionAccess = writableSession,
) {
  const queryClient = createQueryClient();
  const ui = (next: Partial<LiveRunViewProps> & { run: Run }) => (
    <MemoryRouter>
      <ApiContext.Provider value={client}>
        <SessionContext.Provider value={session}>
          <QueryClientProvider client={queryClient}>
            <LiveRunView scope={next.run.scope} runId={next.run.id} showResult={() => undefined} {...next} />
          </QueryClientProvider>
        </SessionContext.Provider>
      </ApiContext.Provider>
    </MemoryRouter>
  );
  const view = render(ui(props));
  return { ...view, queryClient, update: (next: Partial<LiveRunViewProps> & { run: Run }) => view.rerender(ui(next)) };
}
