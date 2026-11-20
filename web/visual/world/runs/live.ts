// The live run "steady-1.2k, run a7f2, revision 4": a nonterminal run, its saved revision and suite,
// and handlers that answer every read the live page makes from a movable "agent" clock.
import { encodeRunEventCursor } from '@beetle/contracts/api';
import { NOW } from '../../harness.js';
import type { Api, Call, Json, Reply } from '../../harness.js';
import { fixture, ids, workspace } from '../index.js';
import { liveFrame, liveHistory, liveIds } from './live-data.js';

export { liveIds } from './live-data.js';
export const elapsedAtNow = 316;
export const tickSeconds = 10;
export const startedAtMs = Date.parse(NOW) - elapsedAtNow * 1000;

const scope = { kind: 'workspace', organizationId: ids.organization, workspaceId: ids.workspace };
const digest = '4'.repeat(64);

/** The agent's clock: handlers build frames for this many seconds into the run. */
export const agent = { elapsed: elapsedAtNow };

export const liveConfig = {
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
    ['checkout', 'Checkout', 'POST', '/checkout'],
    ['cart', 'Cart', 'POST', '/cart'],
    ['product', 'Product', 'GET', '/product/{id}'],
    ['catalog', 'Catalog', 'GET', '/catalog/search'],
    ['health', 'Health', 'GET', '/health'],
  ].map(([id, name, method, path]) => ({ id, name, method, path, query: {}, headers: {}, assertions: [] })),
  datasets: [],
  secrets: [],
  selections: [],
  targetSampling: { path: '/debug/process', intervalMs: 1000, timeoutMs: 500, cooldownMs: 0 },
};

export const liveSuite = {
  ...fixture('suite'),
  id: liveIds.suite,
  name: 'steady-1.2k',
  currentRevisionId: liveIds.revision,
};

const messages = [
  ['First version at 1,000 a second', '2026-11-06T14:10:00.000Z', 2],
  ['More virtual users after dropped iterations', '2026-11-10T09:20:00.000Z', 2],
  ['Added a p99 limit of 300 ms', '2026-11-12T16:05:00.000Z', 3],
  ['Sale-day rate: 1,200 a second', '2026-11-14T11:40:00.000Z', 4],
] as const;
const revisionId = (ordinal: number) =>
  ordinal === 4 ? liveIds.revision : `51e00000-0000-4000-8000-0000000000e${ordinal}`;
export const liveRevision = {
  ...fixture('suite-revision'),
  id: liveIds.revision,
  suiteId: liveIds.suite,
  ordinal: 4,
  digest,
  config: liveConfig as Json,
};
const revisionPage = {
  scope,
  suiteId: liveIds.suite,
  nextCursor: null,
  items: [4, 3, 2, 1].map((ordinal) => ({
    ...fixture('suite-revision-summary-stamped'),
    id: revisionId(ordinal),
    suiteId: liveIds.suite,
    ordinal,
    digest: ordinal === 4 ? digest : String(ordinal).repeat(64),
    savedAt: messages[ordinal - 1]![1],
    message: messages[ordinal - 1]![0],
    savedBy: 'Meera',
    previousRevisionId: ordinal === 1 ? null : revisionId(ordinal - 1),
    runCount: messages[ordinal - 1]![2],
  })),
};

/** The run in its starting (default: active) state, started 5:16 before NOW. */
export function liveRun(patch: Record<string, Json> = {}): Json {
  return {
    ...fixture('run'),
    id: liveIds.run,
    suiteId: liveIds.suite,
    revisionId: liveIds.revision,
    revisionDigest: digest,
    activeAttemptId: liveIds.attempt,
    requestedAt: new Date(startedAtMs - 6000).toISOString(),
    startedAt: new Date(startedAtMs).toISOString(),
    state: 'active',
    requestedBy: 'you',
    engine: { ...(fixture<{ engine: Json }>('run').engine as object), profileId: 'k6' } as Json,
    ...patch,
  };
}

export const queue = {
  ...fixture('run-queue'),
  runId: liveIds.run,
  state: 'queued',
  position: 1,
  slots: { used: 2, runs: 2, exports: 0, configured: 2, effective: 2 },
  holders: [
    { runId: 'c3d10000-0000-4000-8000-000000000001', suiteId: liveIds.suite, suiteName: 'catalog-crawl' },
    { runId: '7e1a0000-0000-4000-8000-000000000001', suiteId: liveIds.suite, suiteName: 'soak-30m' },
  ],
  otherWorkspaceRuns: 0,
  generatedAt: NOW,
};

export interface LiveOptions {
  /** The run replies by call; a plain value is returned every time. */
  run?: Json | ((call: Call) => Json);
  /** Live metrics: frames from the agent clock, failed polls, or never answered. */
  metrics?: 'frames' | 'fail' | 'pending' | ((call: Call) => Reply);
  history?: 'ok' | 'fail';
}

const fresh = { 'x-beetle-live-fresh-for-ms': '6000' };
const frameReply = (): Reply => ({ status: 200, body: liveFrame(startedAtMs, agent.elapsed), headers: fresh });

/** Answers every read the live page makes. Later `api.on` calls may still override one. */
export function installLive(api: Api, options: LiveOptions = {}): void {
  const { run = liveRun(), metrics = 'frames', history = 'ok' } = options;
  api
    .on('getRun', (call) => (typeof run === 'function' ? run(call) : run))
    .on('getSuite', liveSuite)
    .on('getSuiteRevision', liveRevision as unknown as Json)
    .on('listSuiteRevisions', revisionPage as unknown as Json)
    .on('getInstallationStatus', installation())
    .on('getWorkspaceOverview', { ...fixture('workspace-overview'), scope, generatedAt: NOW })
    .on('getRunQueue', queue as Json)
    .on('listRunEvents', () => pendingEvents())
    .on('getRunLiveMetrics', (call) => {
      if (typeof metrics === 'function') return metrics(call);
      if (metrics === 'pending') return 'pending';
      return metrics === 'fail' ? { status: 503, body: unavailable() } : frameReply();
    })
    .on('getRunLiveHistory', () =>
      history === 'fail'
        ? { status: 503, body: unavailable() }
        : liveHistory(startedAtMs, Math.max(1, agent.elapsed - 1)),
    );
  void workspace;
}

function unavailable(): Json {
  return {
    code: 'storage_unavailable',
    message: 'Storage unavailable',
    retryable: true,
    requestId: '00000000-0000-4000-8000-000000000012',
    fields: [],
  };
}

/** Run events for the finalizing view: the agent has begun collecting artifacts. */
export function collectingEvents(): Json {
  const base = fixture<Record<string, Json>>('run-events-pending');
  const event = {
    version: '1.0',
    organizationId: ids.organization,
    workspaceId: ids.workspace,
    attemptId: liveIds.attempt,
    generation: 1,
    seq: 1,
    phase: 'collect',
    observedAt: new Date(startedAtMs + elapsedAtNow * 1000).toISOString(),
    source: 'wrapper',
    wrapperSeq: 1,
    kind: 'phase.started',
    payload: { budget: { phase: 'collect', timeoutMs: 60000, workUnits: 1, outputBytes: 1048576 } },
  };
  return {
    ...base,
    id: liveIds.run,
    activeAttemptId: liveIds.attempt,
    durableThrough: 1,
    coverage: 'contiguous',
    items: [event],
    resumeCursor: cursor(1),
  };
}

/** A SafeError reply with the given status and code. */
export function failure(status: number, code: string, message: string): Reply {
  return {
    status,
    body: { code, message, retryable: false, requestId: '00000000-0000-4000-8000-000000000013', fields: [] },
  };
}

export function pendingEvents(): Json {
  return {
    ...fixture('run-events-pending'),
    id: liveIds.run,
    activeAttemptId: liveIds.attempt,
    resumeCursor: cursor(0),
  };
}

const cursor = (afterSeq: number) =>
  encodeRunEventCursor({
    organizationId: ids.organization,
    workspaceId: ids.workspace,
    runId: liveIds.run,
    attemptId: liveIds.attempt,
    generation: 1,
    afterSeq,
  });

/** Installation status naming the run's exact engine selector, so the start-up step can show its version. */
function installation(): Json {
  const engine = fixture<{ engine: { id: string; configVersion: number } }>('run').engine;
  return {
    ...fixture('installation-status'),
    generatedAt: NOW,
    agent: { ...fixture<{ agent: object }>('installation-status').agent, state: 'ready' },
    engines: [
      {
        profileId: 'k6',
        imageDigest: fixture<{ engine: { imageDigest: string } }>('run').engine.imageDigest,
        image: 'verified_at_agent_start',
        engine: { id: engine.id, version: '0.54.0', configVersion: engine.configVersion },
      },
    ],
  } as Json;
}
