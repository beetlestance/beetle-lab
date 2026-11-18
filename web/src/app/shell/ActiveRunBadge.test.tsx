// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { ApiContext } from '../api.js';
import { createQueryClient, queryKeys } from '../queries.js';
import { SessionContext } from '../session.js';
import { apiError, deferred, ids, json, mount, readNamespace, testClient } from '../test-fixtures.js';
import { routes } from '../routes.js';
import { MemoryRouter } from 'react-router-dom';
import { LiveHeader } from '../../features/runs/live/Header.js';
import { liveRun } from '../../features/runs/live/fixtures.js';
import { ActiveRunBadge } from './ActiveRunBadge.js';
import valid from '../../../../contracts/fixtures/api/valid/workspace-overview.json';

afterEach(cleanup);
function snapshot(active: number, organizationId = ids.a, queued = 0) {
  const value = structuredClone(valid);
  value.scope = { kind: 'workspace', organizationId, workspaceId: ids.workspace };
  const rows = Array.from({ length: active + queued }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    suiteId: ids.folder,
    revisionId: ids.request,
    requestedAt: '2026-11-10T00:00:00.000Z',
    state: i < active ? ('active' as const) : ('queued' as const),
    outcome: 'pending' as const,
  })).reverse();
  value.counts = { ...value.counts, runs: active + queued, active, queued };
  return {
    ...value,
    active: rows.filter((row) => row.state === 'active').slice(0, 20),
    recent: rows.slice(0, 8),
    activeHasMore: active > 20,
  };
}
function fixture(handler: Parameters<typeof testClient>[0], readOnly = false) {
  const api = testClient(handler);
  const client = createQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ApiContext.Provider value={api.client}>
      <SessionContext.Provider value={{ readOnly, restoredBackup: null }}>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </SessionContext.Provider>
    </ApiContext.Provider>
  );
  const load = (organizationId = ids.a, workspaceId: string | null = ids.workspace) =>
    client.fetchQuery({
      queryKey: workspaceId
        ? [...queryKeys.workspace(organizationId, workspaceId), 'overview']
        : [...queryKeys.organization(organizationId), 'overview'],
      queryFn: async () => {
        const result = workspaceId
          ? await api.client.getWorkspaceOverview({ params: { organizationId, workspaceId } })
          : await api.client.getOrganizationOverview({ params: { organizationId } });
        if (!result.ok) throw new Error('Overview unavailable');
        return result.value;
      },
    });
  return { api, client, wrapper, load };
}
it('uses exact active counts beyond the bounded headers and excludes queued work', async () => {
  const pending = deferred<Response>();
  const f = fixture(() => pending.promise);
  render(<ActiveRunBadge organizationId={ids.a} workspaceId={ids.workspace} />, { wrapper: f.wrapper });
  expect(screen.queryByText(/running/)).not.toBeInTheDocument();
  const loading = f.load();
  await act(async () => pending.resolve(json(snapshot(32, ids.a, 2))));
  await loading;
  expect(await screen.findByText('32')).toBeVisible();
  expect(f.api.records).toHaveLength(1);
  expect(f.api.records[0]?.path).toContain(`/workspaces/${ids.workspace}/overview`);
  expect(f.client.getQueryData([...queryKeys.workspace(ids.a, ids.workspace), 'overview'])).toMatchObject({
    counts: { active: 32 },
  });
});
it('hides an earlier count when its authoritative refresh fails', async () => {
  let failed = false;
  const f = fixture(() => (failed ? json(apiError('storage_unavailable'), 503) : json(snapshot(1))));
  render(<ActiveRunBadge organizationId={ids.a} workspaceId={ids.workspace} />, { wrapper: f.wrapper });
  await act(async () => {
    await f.load();
  });
  await screen.findByText('1');
  failed = true;
  await act(async () => {
    await f.load().catch(() => undefined);
  });
  expect(screen.queryByText('1')).not.toBeInTheDocument();
  expect(screen.queryByText('0')).not.toBeInTheDocument();
});
it('never carries the previous scope badge into a pending or late new scope', async () => {
  const pending = deferred<Response>();
  const f = fixture((request) => (request.path.includes(ids.b) ? pending.promise : json(snapshot(1))));
  const view = render(<ActiveRunBadge organizationId={ids.a} workspaceId={ids.workspace} />, { wrapper: f.wrapper });
  await act(async () => {
    await f.load();
  });
  await screen.findByText('1');
  view.rerender(<ActiveRunBadge organizationId={ids.b} workspaceId={ids.workspace} />);
  expect(screen.queryByText('1')).not.toBeInTheDocument();
  const loading = f.load(ids.b);
  await act(async () => pending.resolve(json(snapshot(2, ids.b))));
  await loading;
  expect(await screen.findByText('2')).toBeVisible();
});
it('reads the organisation aggregate when no workspace is selected', async () => {
  const workspace = snapshot(1);
  const body = {
    ...workspace,
    scope: { kind: 'organization', organizationId: ids.a },
    workspaces: 1,
    active: workspace.active.map((row) => ({ ...row, workspaceId: ids.workspace })),
    recent: workspace.recent.map((row) => ({ ...row, workspaceId: ids.workspace })),
  };
  const f = fixture(() => json(body));
  render(<ActiveRunBadge organizationId={ids.a} />, { wrapper: f.wrapper });
  await act(async () => {
    await f.load(ids.a, null);
  });
  expect(await screen.findByText('1')).toBeVisible();
  expect(f.api.records[0]?.path).toBe(`/api/v2/organizations/${ids.a}/overview`);
});
it('issues no aggregate read in unscoped or restored read-only views', async () => {
  const f = fixture(() => {
    throw new Error('Unexpected aggregate read');
  }, true);
  const view = render(<ActiveRunBadge />, { wrapper: f.wrapper });
  view.rerender(<ActiveRunBadge organizationId={ids.a} workspaceId={ids.workspace} />);
  await waitFor(() => expect(f.client.isFetching()).toBe(0));
  expect(f.api.records).toHaveLength(0);
  expect(screen.queryByText(/running/)).not.toBeInTheDocument();
});

it('loads one authoritative header snapshot from a fresh verified Suites scope', async () => {
  const api = testClient((request) =>
    request.path.endsWith('/overview') ? json(snapshot(2)) : readNamespace(request),
  );
  mount(api.client, routes.suites(ids.a, ids.workspace));
  expect(await screen.findByRole('link', { name: /Workspaces\s*,\s*2\s*running/ })).toBeVisible();
  expect(api.records.filter((request) => request.path.endsWith('/overview'))).toHaveLength(1);
  expect(api.records.every((request) => request.method === 'GET')).toBe(true);
});
it('does not request a header snapshot before the route organisation is verified', async () => {
  const api = testClient(() => json({ ...apiError('not_found'), message: 'Resource not found' }, 404));
  mount(api.client, routes.suites(ids.a, ids.workspace));
  expect(await screen.findByRole('alert')).toBeVisible();
  expect(api.records).toHaveLength(1);
  expect(api.records[0]?.path).toBe(`/api/v2/organizations/${ids.a}`);
});

it('keeps the snapshot owned after Overview-to-Suites navigation in the same workspace', async () => {
  let reads = 0;
  const pending = deferred<Response>();
  const api = testClient((request) =>
    request.path.endsWith('/overview') ? (++reads === 1 ? json(snapshot(1)) : pending.promise) : readNamespace(request),
  );
  mount(api.client, routes.workspace(ids.a, ids.workspace));
  await screen.findByRole('link', { name: /Workspaces\s*,\s*1\s*running/ });
  fireEvent.click(screen.getByRole('link', { name: /Workspaces\s*,\s*1\s*running/ }));
  await screen.findByRole('table', { name: 'Folders' });
  await waitFor(() => expect(reads).toBe(2));
  await act(async () => pending.resolve(json(snapshot(2))));
  expect(await screen.findByRole('link', { name: /Workspaces\s*,\s*2\s*running/ })).toBeVisible();
});

function liveHeader(readOnly = false) {
  const run = liveRun({ scope: { kind: 'workspace', organizationId: ids.a, workspaceId: ids.workspace } });
  return (
    <>
      <ActiveRunBadge organizationId={ids.a} workspaceId={ids.workspace} />
      <LiveHeader
        run={run}
        suiteName="Bench"
        revisionOrdinal={4}
        headline="Running"
        sentence="Live readings"
        status={{ label: 'Running', tone: 'running' }}
        stream={null}
        cancel={undefined}
        readOnly={readOnly}
        onScript={() => {}}
      />
    </>
  );
}
it('loads exactly one snapshot on direct run entry after both namespace reads succeed', async () => {
  const f = fixture((request) => (request.path.endsWith('/overview') ? json(snapshot(2)) : readNamespace(request)));
  const Providers = f.wrapper;
  render(liveHeader(), {
    wrapper: ({ children }) => (
      <MemoryRouter>
        <Providers>{children}</Providers>
      </MemoryRouter>
    ),
  });
  expect(await screen.findByText('2')).toBeVisible();
  expect(f.api.records.filter((request) => request.path.endsWith('/overview'))).toHaveLength(1);
  expect(f.api.records.slice(0, 3).map((request) => request.path)).toEqual([
    `/api/v2/organizations/${ids.a}`,
    `/api/v2/organizations/${ids.a}/workspaces/${ids.workspace}`,
    `/api/v2/organizations/${ids.a}/workspaces/${ids.workspace}/overview`,
  ]);
});
it('does not load a live-run header snapshot when namespace verification fails', async () => {
  const f = fixture(() => json(apiError('not_found'), 404));
  const Providers = f.wrapper;
  render(liveHeader(), {
    wrapper: ({ children }) => (
      <MemoryRouter>
        <Providers>{children}</Providers>
      </MemoryRouter>
    ),
  });
  await screen.findByRole('button', { name: 'Retry workspace name' });
  expect(f.api.records).toHaveLength(1);
  expect(f.api.records.some((request) => request.path.endsWith('/overview'))).toBe(false);
});
it('keeps current-work snapshots disabled for restored read-only run views', async () => {
  const f = fixture(readNamespace, true);
  const Providers = f.wrapper;
  render(liveHeader(true), {
    wrapper: ({ children }) => (
      <MemoryRouter>
        <Providers>{children}</Providers>
      </MemoryRouter>
    ),
  });
  await waitFor(() => expect(f.api.records).toHaveLength(2));
  await waitFor(() => expect(f.client.isFetching()).toBe(0));
  expect(f.api.records.some((request) => request.path.endsWith('/overview'))).toBe(false);
});
