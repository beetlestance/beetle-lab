// The organization page world: "Platform team" with Checkout, Search and Payments, plus the
// organization lists behind the scope menu and the first-run screen.
import { NOW } from '../../harness.js';
import type { Api, Json } from '../../harness.js';
import { fixture, ids, organization, signedIn, workspace } from '../index.js';
import { HOUR, NOW_MS, iso, revisionId, suiteIds, today, uuid, workspaceIds } from './ids.js';
import { snapshotFacts } from './facts.js';

type Obj = Record<string, Json>;

const orgScope = { kind: 'organization', organizationId: ids.organization };
const named = (id: string, name: string): Obj => ({ ...workspace, id, name, scope: orgScope });

export const workspaces: Obj[] = [
  { ...workspace, scope: orgScope } as Obj,
  named(workspaceIds.search, 'Search'),
  named(workspaceIds.payments, 'Payments'),
];

interface Row {
  id: string;
  suiteId: string;
  workspaceId: string;
  requestedAt: string;
  state: string;
  outcome: string;
}
type RowSpec = [head: string, n: number, suite: string, ws: string, at: string, state: string, outcome: string];
const row = ([head, n, suite, ws, at, state, outcome]: RowSpec): Row => ({
  id: uuid(head, n),
  suiteId: suite,
  workspaceId: ws,
  requestedAt: today(at),
  state,
  outcome,
});

const checkout = workspaceIds.checkout;
const payments = workspaceIds.payments;
export const orgRuns: Row[] = [
  row(['a7f2', 1, suiteIds.steady, checkout, '23:35', 'active', 'pending']),
  row(['7d49', 2, suiteIds.smoke, payments, '22:28', 'finished', 'passed']),
  row(['b089', 3, suiteIds.steady, checkout, '21:04', 'finished', 'passed']),
  row(['405b', 4, suiteIds.steady, checkout, '20:16', 'finished', 'failed']),
  row(['e118', 5, suiteIds.ramp, payments, '18:40', 'finished', 'passed']),
  row(['f61e', 6, suiteIds.steady, checkout, '15:50', 'cancelled', 'inconclusive']),
  row(['5a0c', 7, suiteIds.smoke, checkout, '03:50', 'finished', 'passed']),
];
/** A contract OrganizationOverview; `empty` is an organization whose workspaces have no runs. */
export function organizationOverview(empty = false, workspaceCount = 3): Obj {
  const base = fixture<{ counts: Obj }>('organization-overview');
  const runs = empty ? [] : orgRuns.map((r) => ({ ...r, revisionId }));
  const facts = snapshotFacts(runs, [], 0);
  return {
    ...base,
    scope: { kind: 'organization', organizationId: ids.organization },
    generatedAt: NOW,
    windowStart: iso(NOW_MS - 24 * HOUR),
    counts: { folders: workspaceCount, suites: empty ? 0 : 5, ...facts.counts },
    activity: facts.buckets,
    recent: runs,
    active: runs.filter((r) => r.state === 'active'),
    activeHasMore: false,
    workspaces: workspaceCount,
  };
}

export const workspacePage = (items: Obj[]): Obj => ({ scope: orgScope, items, nextCursor: null });

/** The organization page: three workspaces, one running. */
export function organizationWorld(api: Api, options: { empty?: boolean; items?: Obj[] } = {}): Api {
  const items = options.items ?? workspaces;
  return signedIn(api)
    .on('listWorkspaces', workspacePage(items))
    .on('getOrganizationOverview', organizationOverview(options.empty ?? false, items.length));
}

const orgNames = [
  'Platform team',
  'Acme Payments',
  'Northwind',
  'Contoso Retail',
  'Fabrikam',
  'Globex',
  'Initech',
  'Umbrella',
  'Hooli',
  'Stark Industries',
];
/** n organizations; the first is "Platform team" (the signed-in one). */
export function organizationList(count: number): Obj[] {
  return Array.from({ length: count }, (_, i) =>
    i === 0
      ? ({ ...organization } as Obj)
      : {
          ...organization,
          id: uuid('0a90', 400 + i),
          name: orgNames[i] ?? `Team ${String(i + 1).padStart(2, '0')}`,
          slug: `team-${i + 1}`,
        },
  );
}

/** Organizations served 20 per page with a cursor, as the scope switcher and Home read them. */
export function organizationsHandler(items: Obj[]) {
  return (call: { query: URLSearchParams }): Json => {
    const offset = Number(call.query.get('cursor')?.replace('c', '') ?? 0);
    const limit = Number(call.query.get('limit') ?? 20);
    const next = offset + limit;
    return {
      scope: { kind: 'installation' },
      items: items.slice(offset, next),
      nextCursor: next < items.length ? `c${next}` : null,
    };
  };
}

export const notFound = (): Json => ({
  status: 404,
  body: { code: 'not_found', message: 'Not found', retryable: false, requestId: ids.organization, fields: [] },
});
