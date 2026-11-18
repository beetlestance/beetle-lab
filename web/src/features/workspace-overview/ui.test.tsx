// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { pendingRunHistorySummary } from '@beetle/contracts/api';
import type { InputRecord, Run, RunHistorySummary, Suite, WorkspaceOverview as Snapshot } from '@beetle/contracts/api';
import { ApiContext } from '../../app/api.js';
import { createQueryClient } from '../../app/queries.js';
import { routes } from '../../app/routes.js';
import { testClient, json, deferred, apiError } from '../../app/test-fixtures.js';
import type { RequestRecord } from '../../app/test-fixtures.js';
import { config as liveConfig } from '../runs/live/fixtures.js';
import { revision as baseRevision, run as baseRun } from '../runs/test-fixtures.js';
import { WorkspaceOverview } from './index.js';
import valid from '../../../../contracts/fixtures/api/valid/workspace-overview.json';
import status from '../../../../contracts/fixtures/api/valid/installation-status.json';

const scope = valid.scope as Snapshot['scope'];
const org = scope.organizationId;
const ws = scope.workspaceId;
const liveId = '00000000-0000-4000-8000-0000000000f1';
const doneId = '00000000-0000-4000-8000-0000000000e2';
const suiteId = '00000000-0000-4000-8000-0000000000c3';
const unknownSuite = '00000000-0000-4000-8000-0000000000c4';
afterEach(cleanup);

const snapshot = (): Snapshot => structuredClone(valid) as Snapshot;
function busy(): Snapshot {
  const value = snapshot();
  const at = value.activity[23]!.from;
  const header = (id: string, state: Run['state'], outcome: Run['outcome'], suite = suiteId) => ({
    id,
    suiteId: suite,
    revisionId: suiteId,
    requestedAt: at,
    state,
    outcome,
  });
  value.counts = { ...value.counts, suites: 3, runs: 2, submitted24h: 2, failed24h: 1, active: 1, finished: 1 };
  value.activity[23]!.count = 2;
  value.recent = [header(liveId, 'active', 'pending'), header(doneId, 'finished', 'failed', unknownSuite)];
  value.active = [header(liveId, 'active', 'pending')];
  return value;
}
function runRow(id: string, state: Run['state'], startedAt: string | null): Run {
  const requestedAt = id === liveId ? '2026-11-10T00:00:01.000Z' : '2026-11-10T00:00:00.000Z';
  const done = state === 'finished';
  const outcome = done ? 'failed' : 'pending';
  return {
    ...baseRun(),
    id,
    scope,
    suiteId,
    state,
    startedAt,
    requestedAt,
    outcome,
    validationStatus: done ? 'passed' : 'pending',
  };
}
function measured(id: string): RunHistorySummary {
  return {
    ...pendingRunHistorySummary(runRow(id, 'finished', null)),
    availability: 'ready',
    source: {
      generation: 1,
      manifestDigest: 'a'.repeat(64),
      numericArtifactId: id,
      numericSha256: 'b'.repeat(64),
      numericVersion: 4,
      measurementSourceTimeMs: 1000,
      coverage: { complete: true, latePoints: 0, markerDelayDroppedBuckets: 0 },
    },
    httpP95: { source: 'histogram-estimate', scale: 4, estimate: 188.2, lower: 180, upper: 190 },
  };
}
const suite = (): Suite => ({
  id: suiteId,
  scope,
  name: 'steady-1.2k',
  version: 1,
  folderId: suiteId,
  currentRevisionId: null,
});
function input(state: InputRecord['state'], index: number): InputRecord {
  return {
    id: `00000000-0000-4000-8000-0000000001${String(index).padStart(2, '0')}`,
    scope,
    name: `input-${index}`,
    folderId: suiteId,
    sha256: 'a'.repeat(64),
    bytes: 12,
    offset: 12,
    version: 1,
    state,
    reason: null,
    createdAt: null,
    publishedAt: null,
    rowCount: null,
    columnCount: null,
    usedByCount: 0,
  };
}
type Reads = { overview?: () => Snapshot; runs?: boolean; inputsMore?: boolean; status?: boolean };
function runReads(path: string, reads: Reads): Response | undefined {
    if (path.includes('/runs?')) {
      if (reads.runs === false) return json(apiError('storage_unavailable'), 503);
      const items = [
        runRow(liveId, 'active', new Date(Date.now() - 316_000).toISOString()),
        runRow(doneId, 'finished', null),
      ];
      return json({
        scope,
        items,
        summaries: [pendingRunHistorySummary(items[0]!), measured(doneId)],
        nextCursor: null,
      });
    }
    if (path.endsWith(`/runs/${liveId}`)) return reads.runs === false
      ? json(apiError('storage_unavailable'), 503)
      : json(runRow(liveId, 'active', new Date(Date.now() - 316_000).toISOString()));
    if (path.includes('/revisions/')) return json({ ...baseRevision(), scope, suiteId, config: liveConfig });
  return undefined;
}
function handler(reads: Reads = {}) {
  return (request: RequestRecord): Response => {
    const path = request.path;
    if (path.endsWith('/overview')) return json((reads.overview ?? busy)());
    if (path.includes('/suites?')) return json({ scope, items: [suite()], nextCursor: null });
    const execution = runReads(path, reads);
    if (execution) return execution;
    if (path.includes('/inputs?')) {
      const items = [input('published', 1), input('published', 2), input('staging', 3)];
      return json({ scope, items, nextCursor: reads.inputsMore ? items[2]!.id : null });
    }
    if (path.endsWith('/installation/status'))
      return reads.status === false ? json(apiError('storage_unavailable'), 503) : json(status);
    throw new Error('Unexpected synthetic route ' + path);
  };
}
function mount(f: ReturnType<typeof testClient>) {
  const client = createQueryClient();
  const element = (organizationId = org) => (
    <MemoryRouter>
      <ApiContext.Provider value={f.client}>
        <QueryClientProvider client={client}>
          <WorkspaceOverview organizationId={organizationId} workspaceId={ws} workspaceName="checkout-team" />
        </QueryClientProvider>
      </ApiContext.Provider>
    </MemoryRouter>
  );
  const view = render(element());
  return { ...view, change: (id: string) => view.rerender(element(id)) };
}

it('shows the empty board with its authoring entry point and measured run capacity', async () => {
  const f = testClient(handler({ overview: snapshot }));
  mount(f);
  expect(await screen.findByRole('heading', { level: 1, name: 'No runs in checkout-team yet' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Write your first suite' })).toHaveAttribute(
    'href',
    routes.newSuite(org, ws, 'form'),
  );
  expect(await screen.findByText(/The agent is ready: 3 CPUs and 7.5 GiB free for runs/)).toBeVisible();
  expect(f.records).toHaveLength(2);
});

it('shows a loading skeleton, then hides counts on a failed refresh and recovers on an explicit retry', async () => {
  let fail = false;
  const f = testClient((request) => (fail ? json(apiError('storage_unavailable'), 503) : handler()(request)));
  mount(f);
  expect(screen.getByRole('status')).toHaveTextContent('Loading workspace overview…');
  expect(await screen.findByRole('heading', { level: 1, name: '1 run in progress' })).toBeVisible();
  fail = true;
  fireEvent.click(screen.getAllByRole('button', { name: 'Refresh overview' })[0]!);
  expect(await screen.findByRole('alert')).toHaveTextContent('Counts are unknown');
  expect(screen.queryByText(/runs submitted/)).not.toBeInTheDocument();
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: 'Refresh overview' }));
  expect(await screen.findByRole('heading', { level: 1, name: '1 run in progress' })).toBeVisible();
});

it('renders hero, live card, activity, recent runs and the agent from real fields only', async () => {
  const f = testClient(handler());
  mount(f);
  expect(await screen.findByRole('heading', { level: 1, name: '1 run in progress' })).toBeVisible();
  expect(
    await screen.findByText('2 runs submitted in the last 24 hours, 1 failed. 3 suites, 2 input files ready.'),
  ).toBeVisible();
  const live = await screen.findByRole('article', { name: `Running run ${liveId}` });
  expect(within(live).getByRole('link', { name: 'Open live run' })).toHaveAttribute(
    'href',
    routes.run(org, ws, liveId),
  );
  expect(await within(live).findByRole('region', { name: 'Progress' })).toHaveTextContent(/05:1\d elapsed/);
  expect(within(live).getByText('steady-1.2k')).toBeVisible();

  const recent = screen.getByRole('region', { name: 'Recent runs' });
  expect(within(recent).getByRole('link', { name: 'All runs' })).toHaveAttribute('href', routes.runs(org, ws));
  const rows = within(recent).getAllByRole('listitem');
  expect(rows[0]).toHaveTextContent('live');
  expect(rows[1]).toHaveTextContent('Failed');
  expect(rows[1]).toHaveTextContent('Unknown suite');
  expect(rows[1]).toHaveTextContent('188 ms');

  const activity = screen.getByRole('region', { name: 'Last 24 hours' });
  expect(within(activity).getAllByRole('row')).toHaveLength(25);
  expect(within(activity).getByText('2 runs submitted in the last 24 hours, by hour')).toBeInTheDocument();

  const agent = screen.getByRole('region', { name: 'Agent' });
  expect(await within(agent).findByText(/^Ready\. standard engine image verified at agent start\.$/)).toBeVisible();
  expect(within(agent).getByText('8 CPUs, use not measured')).toBeVisible();
  expect(within(agent).getByText('16 GiB, use not measured')).toBeVisible();
  expect(within(agent).getByText('186 of 233 GiB')).toBeVisible();
  expect(f.records.every((record) => record.method === 'GET')).toBe(true);
});

it('keeps unproven figures unknown when enrichment reads fail or the inventory is paged', async () => {
  const f = testClient(handler({ runs: false, inputsMore: true, status: false }));
  mount(f);
  expect(await screen.findByText('2 runs submitted in the last 24 hours, 1 failed. 3 suites.')).toBeVisible();
  const agent = screen.getByRole('region', { name: 'Agent' });
  expect(await within(agent).findByText('Agent status unavailable; host figures are unknown.')).toBeVisible();
  const recent = screen.getByRole('region', { name: 'Recent runs' });
  await waitFor(() => expect(within(recent).getAllByRole('listitem')[1]).toHaveTextContent('p95 unknown'));
  const live = await screen.findByRole('article', { name: `Status unknown run ${liveId}` });
  expect(within(live).queryByText(/elapsed/)).not.toBeInTheDocument();
  expect(within(live).getByText('Run status unavailable. Progress and live figures are unknown.')).toBeVisible();
  const reads = f.records.length;
  fireEvent.click(within(agent).getByRole('button', { name: 'Retry agent status' }));
  await waitFor(() => expect(f.records).toHaveLength(reads + 1));
});

it('fences late old-scope snapshots and rejects a foreign reply', async () => {
  const held = deferred<Response>();
  const foreign = '00000000-0000-4000-8000-000000000099';
  const f = testClient((request) => (request.path.includes(foreign) ? json(snapshot()) : held.promise));
  const view = mount(f);
  await waitFor(() => expect(f.records).toHaveLength(1));
  view.change(foreign);
  await screen.findByRole('alert');
  await act(async () => {
    held.resolve(json(busy()));
  });
  expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  expect(f.records).toHaveLength(2);
});
