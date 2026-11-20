// Data for the organization, workspace and folder dialogs: an "acme" organization with the
// "checkout-team", "search" and "platform" workspaces, folders for the Suites screens, and the
// error replies Beetle gives when a dialog's request is refused.
import type { Api, Json } from '../harness.js';
import { NOW } from '../harness.js';
import { fixture, ids, signedIn } from './index.js';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const nsIds = {
  organization: ids.organization,
  checkout: ids.workspace,
  search: uuid(0x102),
  platform: uuid(0x103),
  root: ids.rootFolder,
  capacity: uuid(0x201),
  loadTests: uuid(0x202),
  smoke: uuid(0x203),
  drafts: uuid(0x204),
  deepest: uuid(0x210),
  request: uuid(0x300),
} as const;

const orgScope = { kind: 'installation' } as const;
const wsScope = { kind: 'organization', organizationId: ids.organization } as const;
const folderScope = (workspaceId: string) =>
  ({ kind: 'workspace', organizationId: ids.organization, workspaceId }) as const;

export const acme = { ...fixture('organization'), name: 'acme', slug: 'acme', version: 4 };
const workspaceNamed = (id: string, name: string, version: number) => ({
  ...fixture('workspace'),
  id,
  name,
  version,
  scope: wsScope,
  rootFolderId: id === nsIds.checkout ? nsIds.root : uuid(0x400 + (id.endsWith('102') ? 1 : 2)),
});
export const checkout = workspaceNamed(nsIds.checkout, 'checkout-team', 3);
export const searchWs = workspaceNamed(nsIds.search, 'search', 2);
export const platformWs = workspaceNamed(nsIds.platform, 'platform', 5);
export const workspaces = [checkout, searchWs, platformWs];

/** A safe error as Beetle sends it: fixed message per code, optional field issues and reason. */
export function refusal(
  code: 'conflict' | 'invalid_value' | 'protected_dependency',
  extra: { fields?: { path: string; code: string }[]; reason?: string } = {},
): { status: number; body: Json } {
  const message = {
    conflict: 'Version or intent conflict',
    invalid_value: 'Invalid value',
    protected_dependency: 'Protected dependency',
  }[code];
  const status = code === 'invalid_value' ? 422 : 409;
  const body = { code, message, retryable: false, requestId: nsIds.request, fields: extra.fields ?? [] };
  return { status, body: (extra.reason ? { ...body, reason: extra.reason } : body) as Json };
}

/** Organization snapshot: the contract checks its arithmetic, so counts, buckets and rows agree. */
function overview(): Json {
  const base = fixture<Record<string, Json>>('organization-overview');
  const end = Date.parse(NOW);
  const hour = 3_600_000;
  const iso = (ms: number) => new Date(ms).toISOString();
  const activity = Array.from({ length: 24 }, (_, i) => {
    const from = end - (24 - i) * hour;
    const failed = i % 4 === 0 ? 1 : 0;
    return {
      from: iso(from),
      to: iso(from + hour),
      count: 3,
      outcomes: { passed: 3 - failed, failed, inProgress: 0, other: 0 },
    };
  });
  const recent = Array.from({ length: 8 }, (_, i) => ({
    id: uuid(0x800 + i),
    suiteId: uuid(0x700 + (i % 4)),
    revisionId: uuid(0x900 + (i % 4)),
    requestedAt: iso(end - (i * 45 + 10) * 60_000),
    state: 'finished',
    outcome: 'passed',
    workspaceId: i % 3 === 0 ? nsIds.search : nsIds.checkout,
  }));
  return {
    ...base,
    scope: { kind: 'organization', organizationId: ids.organization },
    generatedAt: NOW,
    windowStart: iso(end - 24 * hour),
    counts: {
      folders: 9,
      suites: 20,
      runs: 400,
      submitted24h: 72,
      failed24h: 6,
      queued: 0,
      dispatching: 0,
      active: 0,
      finalizing: 0,
      finished: 390,
      cancelled: 6,
      errored: 4,
    },
    activity,
    recent,
    active: [],
    activeHasMore: false,
    workspaces: 3,
  };
}

/** Session, installation and the acme organization with its three workspaces. */
export function acmeWorld(api: Api): Api {
  return signedIn(api)
    .on('listOrganizations', { scope: orgScope, items: [acme], nextCursor: null })
    .on('getOrganization', acme)
    .on('listWorkspaces', { scope: wsScope, items: workspaces, nextCursor: null })
    .on('getOrganizationOverview', overview())
    .on('getWorkspace', (call) => workspaces.find((w) => w.id === call.params.workspaceId) ?? checkout);
}

const folderOf = (id: string, name: string, parent: string, path: string[], version = 2) => ({
  ...fixture('folder'),
  id,
  name,
  version,
  scope: folderScope(nsIds.checkout),
  parentFolderId: parent,
  displayPath: path,
});
export const capacity = folderOf(nsIds.capacity, 'capacity', nsIds.root, ['checkout-team', 'capacity']);
export const loadTests = folderOf(nsIds.loadTests, 'load-tests', nsIds.root, ['checkout-team', 'load-tests']);
export const smoke = folderOf(nsIds.smoke, 'smoke', nsIds.root, ['checkout-team', 'smoke']);
export const drafts = folderOf(nsIds.drafts, 'drafts', nsIds.root, ['checkout-team', 'drafts']);
const letters = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
/** a / b / c / d / e / f / g under the root: the seventh child is 8 levels counting the workspace. */
export const chain = letters.map((name, i) =>
  folderOf(
    i === letters.length - 1 ? nsIds.deepest : uuid(0x220 + i),
    name,
    i === 0 ? nsIds.root : uuid(0x220 + i - 1),
    ['checkout-team', ...letters.slice(0, i + 1)],
  ),
);

const summaryOf = (folderId: string, suiteCount: number, subfolderCount: number, failed = 0) => ({
  folderId,
  suiteCount,
  subfolderCount,
  groups: { in_progress: 0, passed: suiteCount - failed, failed, inconclusive: 0, stopped: 0, no_runs: 0 },
  latestRun:
    suiteCount === 0
      ? null
      : {
          suiteId: uuid(0x500 + suiteCount),
          runId: uuid(0x600 + suiteCount),
          state: 'finished',
          outcome: failed ? 'failed' : 'passed',
          requestedAt: '2026-11-07T22:50:00.000Z',
          suiteName: 'steady-1.2k-sale',
          startedAt: '2026-11-07T22:50:10.000Z',
          testDurationMs: 600_000,
        },
});

export interface FolderWorld {
  readonly extra?: readonly (typeof capacity)[];
}
/** The workspace snapshot the Suites screens poll; an idle workspace keeps its arithmetic trivial. */
function idleWorkspaceOverview(): Json {
  const end = Date.parse(NOW);
  const hour = 3_600_000;
  const activity = Array.from({ length: 24 }, (_, i) => ({
    from: new Date(end - (24 - i) * hour).toISOString(),
    to: new Date(end - (23 - i) * hour).toISOString(),
    count: 0,
    outcomes: { passed: 0, failed: 0, inProgress: 0, other: 0 },
  }));
  const counts = Object.fromEntries(
    ['folders', 'suites', 'runs', 'submitted24h', 'failed24h', 'queued', 'dispatching', 'active', 'finalizing']
      .concat(['finished', 'cancelled', 'errored'])
      .map((key) => [key, 0]),
  );
  return {
    ...fixture<Record<string, Json>>('workspace-overview'),
    scope: folderScope(nsIds.checkout),
    generatedAt: NOW,
    windowStart: new Date(end - 24 * hour).toISOString(),
    counts,
    activity,
    recent: [],
    active: [],
    activeHasMore: false,
  };
}

const suiteNames = ['steady-1.2k-sale', 'spike-5k-launch', 'soak-400-overnight', 'ramp-3k-checkout'];
/** Four suites of the capacity folder, newest run first as the contract's recent_run order demands. */
function capacitySuites() {
  const rows = suiteNames.map((name, n) => {
    const id = uuid(0x790 - n);
    const run = {
      suiteId: id,
      runId: uuid(0x680 - n),
      state: 'finished',
      outcome: 'passed',
      requestedAt: new Date(Date.parse(NOW) - (n + 1) * 3_600_000).toISOString(),
      suiteName: name,
      startedAt: new Date(Date.parse(NOW) - (n + 1) * 3_600_000 + 10_000).toISOString(),
      testDurationMs: 600_000,
    };
    const item = {
      ...fixture('suite'),
      id,
      name,
      scope: folderScope(nsIds.checkout),
      folderId: nsIds.capacity,
      currentRevisionId: uuid(0x980 - n),
    };
    return { item, summary: { suiteId: id, engineId: 'k6', group: 'passed', latestRun: run } };
  });
  return { items: rows.map((row) => row.item), summaries: rows.map((row) => row.summary) };
}

/** Suites screens for checkout-team: folder inventory, a folder's suites and the workspace itself. */
export function suitesWorld(api: Api, world: FolderWorld = {}): Api {
  const withSuites = [
    [capacity, summaryOf(nsIds.capacity, 4, 0)],
    [loadTests, summaryOf(nsIds.loadTests, 6, 2, 1)],
    [smoke, summaryOf(nsIds.smoke, 3, 0)],
    [drafts, summaryOf(nsIds.drafts, 0, 0)],
  ] as const;
  const chained = (world.extra ?? []).map((folder) => [folder, summaryOf(folder.id, 0, 0)] as const);
  const all = [...withSuites, ...chained];
  const suites = capacitySuites();
  return acmeWorld(api)
    .on('getWorkspaceOverview', idleWorkspaceOverview())
    .on('getSuiteRevision', (call) => {
      const n = 0x980 - parseInt(call.params.revisionId!.slice(-12), 10);
      return {
        ...fixture<Record<string, Json>>('suite-revision'),
        id: call.params.revisionId!,
        suiteId: uuid(0x790 - n),
        scope: folderScope(nsIds.checkout),
      };
    })
    .on('listFolders', {
      scope: folderScope(nsIds.checkout),
      items: all.map(([folder]) => folder) as unknown as Json[],
      nextCursor: null,
      summaries: all.map(([, summary]) => summary) as Json[],
    })
    .on('listSuites', {
      scope: folderScope(nsIds.checkout),
      items: suites.items as unknown as Json[],
      nextCursor: null,
      summaries: suites.summaries as unknown as Json[],
    });
}

/** Settings reads for the organization and workspace pages that hold the retire controls. */
export function settingsWorld(api: Api): Api {
  const common = { ...fixture<Record<string, Json>>('workspace-settings') };
  return api
    .on('getOrganizationSettings', {
      ...fixture('organization-settings'),
      scope: { kind: 'organization', organizationId: ids.organization },
    })
    .on('getWorkspaceSettings', { ...common, scope: folderScope(nsIds.checkout) })
    .on('listWorkspaceRetention', { scope: folderScope(nsIds.checkout), items: [], nextCursor: null });
}
