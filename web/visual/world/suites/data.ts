// Folders, suites, revisions and runs of the checkout workspace, shaped like the Penpot boards.
import type { Json } from '../../harness.js';
import { NOW } from '../../harness.js';
import { fixture } from '../index.js';
import { config, simpleConfig } from './config.js';
import type { ConfigOptions } from './config.js';
import { folderIds, hex, runIds, scope, steady, uuid } from './ids.js';

export type Obj = Record<string, Json>;
const iso = (offsetMinutes: number) => new Date(Date.parse(NOW) + offsetMinutes * 60_000).toISOString();
/** Absolute UTC time in the week before NOW: `at('11-03 11:40')`. */
export const at = (stamp: string) => `2026-${stamp.replace(' ', 'T')}:00.000Z`;

const folder = (id: string, name: string, parent: string | null, path: string[]): Obj => ({
  id,
  version: 2,
  scope,
  name,
  parentFolderId: parent,
  displayPath: path,
});
export const folders = {
  root: { ...folder(folderIds.root, 'root', null, []) },
  capacity: folder(folderIds.capacity, 'capacity', folderIds.root, ['capacity']),
  smoke: folder(folderIds.smoke, 'smoke', folderIds.root, ['smoke']),
  regression: folder(folderIds.regression, 'regression', folderIds.root, ['regression']),
  endurance: folder(folderIds.endurance, 'endurance', folderIds.root, ['endurance']),
  checkout: folder(folderIds.regressionCheckout, 'checkout', folderIds.regression, ['regression', 'checkout']),
  catalog: folder(folderIds.regressionCatalog, 'catalog', folderIds.regression, ['regression', 'catalog']),
  loadTests: folder(folderIds.datasets, 'load-tests', folderIds.root, ['load-tests']),
};

const group = (g: Partial<Record<string, number>>) => ({
  in_progress: 0,
  passed: 0,
  failed: 0,
  inconclusive: 0,
  stopped: 0,
  no_runs: 0,
  ...g,
});
interface LatestRun {
  suiteId: string;
  runId: string;
  state: string;
  outcome: string;
  requestedAt: string;
  suiteName: string;
  startedAt: string | null;
  testDurationMs: number | null;
}
const latest = (
  suiteName: string,
  [suiteId, runId]: [string, string],
  requested: string,
  outcome: string,
  ms: number | null,
): LatestRun => ({
  suiteId,
  runId,
  suiteName,
  state: outcome === 'pending' ? 'active' : 'finished',
  outcome,
  requestedAt: requested,
  startedAt: outcome === 'pending' ? iso(-5.27) : requested,
  testDurationMs: ms,
});
const summary = (
  folderId: string,
  suiteCount: number,
  subfolderCount: number,
  groups: Obj,
  latestRun: LatestRun | null,
): Obj => ({ folderId, suiteCount, subfolderCount, groups, latestRun: latestRun as unknown as Json });

export interface FolderOptions {
  /** Folder inventory with no suites at all. */
  empty?: boolean;
  /** Adds an empty `load-tests` folder. */
  withEmptyFolder?: boolean;
}
/** The folder inventory: the workspace root plus four top-level folders, two of them with subfolders. */
export function folderPage({ empty = false, withEmptyFolder = false }: FolderOptions = {}): Obj {
  const rootSummary = summary(folderIds.root, 0, empty ? 0 : 4, group({}), null);
  if (empty) return { scope, items: [folders.root], nextCursor: null, summaries: [rootSummary] };
  const items = [folders.root, folders.capacity, folders.smoke, folders.regression, folders.endurance];
  const sums = [
    rootSummary,
    summary(
      folderIds.capacity,
      20,
      0,
      group({ in_progress: 1, passed: 16, failed: 2, no_runs: 1 }),
      latest('steady-1.2k', [steady.id, runIds.running], iso(-5), 'pending', null),
    ),
    summary(
      folderIds.smoke,
      12,
      0,
      group({ passed: 12 }),
      latest('smoke-catalog', [uuid(2, 30), runIds.passed], at('11-07 22:28'), 'passed', 60_000),
    ),
    summary(
      folderIds.regression,
      9,
      2,
      group({ passed: 8, failed: 1 }),
      latest('checkout-regression', [uuid(2, 31), runIds.failed], at('11-07 20:10'), 'failed', 252_000),
    ),
    summary(
      folderIds.endurance,
      4,
      0,
      group({ passed: 3, no_runs: 1 }),
      latest('soak-27m', [uuid(2, 32), runIds.passedOld], at('11-07 14:40'), 'passed', 1_620_000),
    ),
  ];
  if (withEmptyFolder) {
    items.push(folders.loadTests);
    sums.push(summary(folderIds.datasets, 0, 0, group({}), null));
  }
  return { scope, items, nextCursor: null, summaries: sums };
}

interface Row {
  name: string;
  description: string;
  shape: 'constant' | 'ramping';
  minutes: number;
  requests: number;
  ordinal: number;
  saved: string;
  group: string;
  run: string | null;
  runOutcome?: string;
}
const rows: Row[] = [
  {
    name: 'steady-1.2k',
    description: 'Holds checkout traffic at the rate we expect on a sale day.',
    shape: 'ramping',
    minutes: 10,
    requests: 5,
    ordinal: 4,
    saved: '11-03 11:40',
    group: 'in_progress',
    run: iso(-5),
    runOutcome: 'pending',
  },
  {
    name: 'ramp-until-break',
    description: 'Finds the rate where checkout stops keeping up.',
    shape: 'ramping',
    minutes: 14,
    requests: 5,
    ordinal: 2,
    saved: '11-03 11:40',
    group: 'passed',
    run: at('11-07 18:40'),
    runOutcome: 'passed',
  },
  {
    name: 'checkout-spike-3k',
    description: 'Jumps from 300 to 3,000 a second for two minutes.',
    shape: 'ramping',
    minutes: 6,
    requests: 5,
    ordinal: 3,
    saved: '11-02 16:05',
    group: 'failed',
    run: at('11-07 16:12'),
    runOutcome: 'failed',
  },
  {
    name: 'cart-merge-800',
    description: 'Holds 800 cart merges a second against the cart service.',
    shape: 'constant',
    minutes: 8,
    requests: 4,
    ordinal: 2,
    saved: '11-01 10:30',
    group: 'passed',
    run: at('11-07 12:05'),
    runOutcome: 'passed',
  },
  {
    name: 'payment-auth-400',
    description: 'Card authorisation at the evening peak rate.',
    shape: 'constant',
    minutes: 10,
    requests: 2,
    ordinal: 5,
    saved: '11-03 09:50',
    group: 'passed',
    run: at('11-07 10:44'),
    runOutcome: 'passed',
  },
  {
    name: 'promo-burst',
    description: 'Coupon checks during a flash-sale burst.',
    shape: 'ramping',
    minutes: 12,
    requests: 3,
    ordinal: 1,
    saved: '10-30 17:20',
    group: 'failed',
    run: at('11-06 21:30'),
    runOutcome: 'failed',
  },
  {
    name: 'address-lookup-600',
    description: 'Address autocomplete under steady load.',
    shape: 'constant',
    minutes: 5,
    requests: 2,
    ordinal: 2,
    saved: '10-29 11:00',
    group: 'passed',
    run: at('11-06 19:02'),
    runOutcome: 'passed',
  },
  {
    name: 'guest-checkout-1k',
    description: 'Guest checkout without a session at 1,000 a second.',
    shape: 'constant',
    minutes: 10,
    requests: 5,
    ordinal: 1,
    saved: '11-03 11:40',
    group: 'no_runs',
    run: null,
  },
  ...Array.from({ length: 12 }, (_, index): Row => ({
    name: `capacity-probe-${(index + 1) * 100}`,
    description: 'Short capacity probe against the checkout service.',
    shape: 'constant',
    minutes: 5,
    requests: 3,
    ordinal: 1,
    saved: '10-28 10:00',
    group: 'no_runs',
    run: null,
  })),
];
// Runless probes get smaller ids than guest-checkout-1k so recent_run order keeps it eighth.
const suiteIdOf = (index: number) => (index === 0 ? steady.id : uuid(2, index < 8 ? 100 + index : 50 + index));
const revisionIdOf = (index: number) => (index === 0 ? steady.revisions[3]! : uuid(6, index));

export interface SuiteEntry {
  suite: Obj;
  summary: Obj;
  revision: Obj;
}
export const entries: SuiteEntry[] = rows.map((row, index) => {
  const id = suiteIdOf(index);
  const runId = index === 0 ? runIds.running : uuid(5, 100 + index);
  const revision = {
    id: revisionIdOf(index),
    scope,
    suiteId: id,
    ordinal: row.ordinal,
    engineId: 'k6',
    configVersion: 1,
    digest: hex('a'),
    preflightStatus: 'passed',
    config: index === 0 ? config() : simpleConfig(row.shape, row.minutes, row.requests),
    inputManifest: [],
    savedAt: at(row.saved),
    savedBy: 'Meera',
    message: row.ordinal === 1 ? 'First version' : 'Tuned the rate',
    runCount: row.ordinal,
  };
  return {
    suite: {
      id,
      scope,
      version: 4,
      name: row.name,
      folderId: folderIds.capacity,
      currentRevisionId: revision.id,
      description: row.description,
    },
    summary: {
      suiteId: id,
      engineId: 'k6',
      group: row.group,
      latestRun: row.run
        ? (latest(row.name, [id, runId], row.run, row.runOutcome ?? 'passed', 600_000) as unknown as Json)
        : null,
    },
    revision,
  };
});
export const steadySuite = entries[0]!.suite;

const messages = [
  'First version at 1,000 a second',
  'More virtual users after dropped iterations',
  'Added a p99 limit of 300 ms',
  'Sale-day rate: 1,200 a second',
];
const saved = ['10-28 14:10', '10-30 09:20', '11-01 16:05', '11-03 11:40'];
const optionsFor: ConfigOptions[] = [
  { peak: 1000, maxVUs: 200, preAllocatedVUs: 100, p99: false },
  { peak: 1000, maxVUs: 240, preAllocatedVUs: 120, p99: false },
  { peak: 1000, maxVUs: 240, preAllocatedVUs: 120 },
  { peak: 1200, maxVUs: 240, preAllocatedVUs: 120 },
];
/** Revisions 1 to 4 of steady-1.2k; each differs from the last in one thing the Revisions tab reports. */
export function steadyRevisions(overrides: Partial<ConfigOptions> = {}): Obj[] {
  return steady.revisions.map((id, index) => ({
    id,
    scope,
    suiteId: steady.id,
    ordinal: index + 1,
    engineId: 'k6',
    configVersion: 1,
    digest: hex('abcd'[index]!),
    preflightStatus: 'passed',
    config: config({ ...optionsFor[index], ...(index === 3 ? overrides : {}) }),
    inputManifest: [],
    savedAt: at(saved[index]!),
    savedBy: 'Meera',
    message: messages[index]!,
    runCount: [2, 2, 3, 4][index]!,
  }));
}
export const revisionSummary = (revision: Obj, index: number): Obj => {
  const rest = { ...revision };
  delete rest.config;
  delete rest.inputManifest;
  return { ...rest, previousRevisionId: index === 0 ? null : steady.revisions[index - 1]! };
};

const run = (
  id: string,
  [state, outcome]: [string, string],
  requested: string,
  ordinal: number,
  extra: Obj = {},
): Obj => ({
  ...fixture('run'),
  id,
  scope,
  suiteId: steady.id,
  revisionId: steady.revisions[ordinal - 1]!,
  revisionDigest: hex('abcd'[ordinal - 1]!),
  requestedAt: requested,
  state,
  outcome,
  validationStatus: state === 'finished' ? 'passed' : 'pending',
  ...extra,
});
/** The five most recent runs of steady-1.2k, newest first. */
export const recentRuns: Obj[] = [
  run(runIds.running, ['active', 'pending'], iso(-5), 4, { startedAt: iso(-5.27) }),
  run(runIds.passed, ['finished', 'passed'], at('11-07 21:04'), 4),
  run(runIds.failed, ['finished', 'failed'], at('11-07 20:16'), 4),
  run(runIds.cancelled, ['cancelled', 'inconclusive'], at('11-06 21:06'), 3, {
    cancellationRequested: true,
    reason: 'cancelled',
  }),
  run(runIds.passedOld, ['finished', 'passed'], at('11-06 17:48'), 3),
];
