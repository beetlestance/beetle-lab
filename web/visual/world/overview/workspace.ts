// The workspace dashboard world: "Checkout" with one active run, recent runs, hourly activity.
import { NOW } from '../../harness.js';
import type { Api, Json } from '../../harness.js';
import { fixture, ids, signedIn } from '../index.js';
import { HOUR, NOW_MS, iso, revisionId, suiteIds, suiteNames, uuid } from './ids.js';
import { snapshotFacts } from './facts.js';
import type { Hidden } from './facts.js';
import { liveRunHandlers } from './live.js';
import { headerOf, runPage, runSpecs } from './runs.js';
import type { RunSpec } from './runs.js';

type Obj = Record<string, Json>;

export interface OverviewOptions {
  /** Newest first; at most 8 are listed, and exactly min(8, runs). */
  readonly recent?: readonly RunSpec[];
  /** In-window runs the recent list does not show (they make the bars taller than the list). */
  readonly hidden?: readonly Hidden[];
  /** Finished runs older than 24 hours (they only add to the total). */
  readonly older?: number;
  readonly suites?: number;
}

/** One in-window run older than the eight listed, so the bars hold one more than the list. */
export const boardHidden: Hidden[] = [{ hour: 1, outcome: 'passed' }];

/** A contract WorkspaceOverview. Defaults to the populated board (one run active). */
export function workspaceOverview(options: OverviewOptions = {}): Obj {
  const recent = options.recent ?? runSpecs;
  const active = recent.filter((r) => r.state === 'active');
  const facts = snapshotFacts(recent.map(headerOf) as never, options.hidden ?? boardHidden, options.older);
  return {
    ...fixture('workspace-overview'),
    generatedAt: NOW,
    windowStart: iso(NOW_MS - 24 * HOUR),
    counts: { folders: 3, suites: options.suites ?? 5, ...facts.counts },
    activity: facts.buckets,
    recent: recent.map(headerOf),
    active: active.map(headerOf),
    activeHasMore: false,
  };
}

const GiB = 1024 ** 3;
const measured = (value: number) => ({ status: 'measured', value });

/** Installation status with the board's host figures: 62% of 8 CPUs, 2.3 of 6 GiB, 8.2 of 20 GiB. */
export function measuredStatus(): Obj {
  const base = fixture<Obj>('installation-status');
  return {
    ...base,
    generatedAt: NOW,
    agent: { state: 'ready', lastSeenAt: iso(NOW_MS - 4000), checkedAt: iso(NOW_MS - 4000) },
    host: {
      source: 'docker-daemon',
      cpuCores: measured(8),
      memoryTotalBytes: measured(6 * GiB),
      cpuUsedMillis: measured(4960),
      memoryAvailableBytes: measured(Math.round(3.7 * GiB)),
    },
    disk: {
      ...(base.disk as Obj),
      backendTotalBytes: measured(20 * GiB),
      backendFreeBytes: measured(Math.round(11.8 * GiB)),
    },
  };
}

/** Suites in the contract's recent-run order: each shows its newest listed run; no-run suites last. */
const suitePage = (recent: readonly RunSpec[]): Obj => {
  const base = fixture<{ items: Obj[]; summaries: Obj[] }>('suite-page');
  const rows = Object.entries(suiteNames).map(([id, name]) => {
    const latest = recent.find((run) => run.suiteId === id);
    const latestRun = latest
      ? {
          suiteId: id,
          runId: latest.id,
          state: latest.state,
          outcome: latest.outcome,
          requestedAt: latest.requestedAt,
          suiteName: name,
          startedAt: null,
          testDurationMs: null,
        }
      : null;
    const group = !latest
      ? 'no_runs'
      : latest.state === 'active'
        ? 'in_progress'
        : latest.state === 'finished'
          ? latest.outcome
          : 'stopped';
    return { id, name, latestRun, group };
  });
  rows.sort((a, b) => {
    const left = a.latestRun?.requestedAt ?? '';
    const right = b.latestRun?.requestedAt ?? '';
    return left === right ? (a.id < b.id ? 1 : -1) : left < right ? 1 : -1;
  });
  return {
    ...base,
    items: rows.map(({ id, name }) => ({ ...base.items[0]!, id, name, currentRevisionId: revisionId })),
    summaries: rows.map(({ id, latestRun, group }) => ({ suiteId: id, engineId: 'k6', group, latestRun })) as Json[],
    nextCursor: null,
  };
};

const inputPage = (count: number): Obj => {
  const base = fixture<{ items: Obj[] }>('input-page');
  const names = ['customers.csv', 'products.csv', 'carts.csv', 'coupons.csv'];
  return {
    ...base,
    items: names
      .slice(0, count)
      .map((name, i) => ({
        ...base.items[0]!,
        id: uuid('1a00', 300 + i),
        name,
        state: 'published',
        offset: (base.items[0] as Obj).bytes,
      })),
    nextCursor: null,
  };
};

/** Everything the Checkout dashboard reads. Callers override single operations afterwards. */
export function workspaceWorld(api: Api, options: OverviewOptions & { status?: Obj } = {}): Api {
  signedIn(api)
    .on('getWorkspaceOverview', workspaceOverview(options))
    .on('listSuites', suitePage(options.recent ?? runSpecs))
    .on('listRuns', runPage([...(options.recent ?? runSpecs)]))
    .on('listInputs', inputPage(4))
    .on('getInstallationStatus', options.status ?? measuredStatus());
  return liveRunHandlers(api);
}

export const workspaceUrl = `/organizations/${ids.organization}/workspaces/${ids.workspace}`;
export { suiteIds };
