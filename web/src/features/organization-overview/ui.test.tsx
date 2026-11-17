// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { OrganizationOverview as Snapshot } from '@beetle/contracts/api';
import { routes } from '../../app/routes.js';
import { apiError, deferred, ids, json, mount, readNamespace, testClient, workspace } from '../../app/test-fixtures.js';
import valid from '../../../../contracts/fixtures/api/valid/organization-overview.json';
afterEach(cleanup);

const other = '00000000-0000-4000-8000-000000000081';
type Row = Snapshot['recent'][number];
const row = (id: string, workspaceId: string, requestedAt: string, state: 'active' | 'finished', outcome: 'pending' | 'failed'): Row => ({
  id,
  workspaceId,
  suiteId: id,
  revisionId: id,
  requestedAt,
  state,
  outcome,
});
function base(organizationId = ids.a): Snapshot {
  const value = structuredClone(valid) as Snapshot;
  value.scope = { kind: 'organization', organizationId };
  value.workspaces = 2;
  value.counts = { ...value.counts, folders: 2 };
  value.activity[23]!.count = 2;
  return value;
}
function snapshot(organizationId = ids.a): Snapshot {
  const value = base(organizationId);
  const at = value.activity[23]!.from;
  value.counts = { ...value.counts, runs: 2, submitted24h: 2, failed24h: 1, active: 1, finished: 1 };
  value.recent = [
    row('00000000-0000-4000-8000-000000000099', ids.workspace, at, 'active', 'pending'),
    row('00000000-0000-4000-8000-000000000098', other, at, 'finished', 'failed'),
  ];
  value.active = [value.recent[0]!];
  value.activeHasMore = false;
  return value;
}
/** 30 runs, 21 active and more than the listed 20, none of the listed ones in the selected workspace. */
function crowded(): Snapshot {
  const value = base();
  const before = new Date(Date.parse(value.windowStart) - 3_600_000).toISOString();
  value.counts = { ...value.counts, runs: 30, submitted24h: 2, failed24h: 1, active: 21, finished: 9 };
  value.active = Array.from({ length: 20 }, (_, index) =>
    row(`00000000-0000-4000-8000-0000000002${String(99 - index).padStart(2, '0')}`, other, before, 'active', 'pending'),
  );
  value.recent = value.active.slice(0, 8);
  value.activeHasMore = true;
  return value;
}
function reads(overview: () => Response = () => json(snapshot())) {
  return (request: { path: string; method: string }) =>
    request.path.endsWith('/overview') ? overview() : readNamespace(request as Parameters<typeof readNamespace>[0]);
}

it('renders the organization hero and per-workspace figures the snapshot can prove', async () => {
  const api = testClient(reads());
  mount(api.client, routes.organization(ids.a));
  expect(await screen.findByRole('heading', { level: 1, name: 'Same organization' })).toBeVisible();
  expect(
    await screen.findByText('2 workspaces, 1 in progress, 2 runs submitted in the last 24 hours, 1 failed.'),
  ).toBeVisible();
  expect(screen.getByRole('link', { name: 'Organization settings' })).toHaveAttribute(
    'href',
    routes.organizationSettings(ids.a),
  );
  const table = await screen.findByRole('table', { name: 'Workspaces' });
  const row = within(table).getByRole('row', { name: /Same workspace/ });
  expect(within(row).getByText('1 running')).toBeVisible();
  expect(within(row).getByText('Running')).toBeVisible();
  expect(within(row).getByRole('link', { name: 'Same workspace' })).toHaveAttribute(
    'href',
    routes.workspace(ids.a, ids.workspace),
  );
  expect(api.records.filter((record) => record.path.endsWith('/overview'))).toHaveLength(1);
  expect(api.records.every((record) => record.method === 'GET')).toBe(true);
});

it('labels per-workspace figures unknown when the snapshot cannot prove them', async () => {
  const api = testClient(reads(() => json(crowded())));
  mount(api.client, routes.organization(ids.a));
  const table = await screen.findByRole('table', { name: 'Workspaces' });
  const row = within(table).getByRole('row', { name: /Same workspace/ });
  await waitFor(() => expect(within(row).getByText('Not among the 8 latest')).toBeVisible());
  expect(within(row).getByText('Unknown')).toBeVisible();
});

it('hides cached counts after a failed manual refresh and keeps the workspace list usable', async () => {
  let fail = false;
  const api = testClient(reads(() => (fail ? json(apiError('storage_unavailable'), 503) : json(snapshot()))));
  mount(api.client, routes.organization(ids.a));
  await screen.findByText(/2 runs submitted/);
  fail = true;
  fireEvent.click(screen.getByRole('button', { name: 'Refresh organization overview' }));
  expect(await screen.findByText('Organization overview unavailable. Counts are unknown.')).toBeVisible();
  expect(screen.queryByText(/2 runs submitted/)).not.toBeInTheDocument();
  const table = screen.getByRole('table', { name: 'Workspaces' });
  expect(within(table).getAllByText('Unknown')).toHaveLength(2);
});

it('shows the empty organization with create and settings actions', async () => {
  const api = testClient((request) =>
    request.path.includes('/workspaces?')
      ? json({ scope: workspace().scope, items: [], nextCursor: null })
      : reads()(request),
  );
  mount(api.client, routes.organization(ids.a));
  expect(await screen.findByRole('heading', { name: 'No workspaces in Same organization yet' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Create workspace' })).toBeEnabled();
  expect(screen.getAllByRole('link', { name: 'Organization settings' })).toHaveLength(2);
});

it('shows a loading skeleton for the workspace table', async () => {
  const held = deferred<Response>();
  const api = testClient((request) => (request.path.includes('/workspaces?') ? held.promise : reads()(request)));
  mount(api.client, routes.organization(ids.a));
  expect(await screen.findByText('Loading workspaces…')).toBeInTheDocument();
  held.resolve(json({ scope: workspace().scope, items: [workspace()], nextCursor: null }));
  expect(await screen.findByRole('table', { name: 'Workspaces' })).toBeVisible();
});

it('shows not found for a missing organization instead of an empty dashboard', async () => {
  const api = testClient(() => json(apiError('not_found'), 404));
  mount(api.client, routes.organization(ids.a));
  expect(await screen.findByRole('heading', { name: "That organization isn't here" })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Back to organizations' })).toHaveAttribute('href', routes.organizations);
  expect(api.records).toHaveLength(1);
});

it('shows not found for a missing workspace with a link back to its organization', async () => {
  const api = testClient((request) =>
    request.path.endsWith(`/workspaces/${ids.workspace}`) ? json(apiError('not_found'), 404) : readNamespace(request),
  );
  mount(api.client, routes.workspace(ids.a, ids.workspace));
  expect(await screen.findByRole('heading', { name: "That workspace isn't here" })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Back to workspaces' })).toHaveAttribute('href', routes.organization(ids.a));
});
