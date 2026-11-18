// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { queryKeys } from '../../../app/queries.js';
import type { Run } from '@beetle/contracts/api';
import { LiveMetricReads } from '../live-metrics/read.js';
import { ids, json, liveFrame, liveRun, mountLive, routesFor, suiteId } from './fixtures.js';

/** A run that started 5 min 16 s ago: inside the steady stage. */
const recent = (patch: Partial<Run> = {}) =>
  liveRun({ startedAt: new Date(Date.now() - 316_000).toISOString(), ...patch });

beforeEach(() => vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible'));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function running(current: Run = recent()) {
  let sequence = 0;
  const read = vi
    .spyOn(LiveMetricReads.prototype, 'read')
    .mockImplementation(async () => liveFrame(current, ++sequence));
  const fixture = routesFor(() => current);
  const view = mountLive(fixture.client, { run: current });
  await screen.findByRole('heading', { name: 'Holding 1,200 a second' });
  return { read, fixture, view };
}

it('shows the running board: headline, threshold sentence, stage progress, figures and endpoints', async () => {
  await running();
  expect(
    screen.getByText(
      '2 of 3 thresholds are holding; the rest are checked when the run is sealed. p95 is at most 236 ms against a 250 ms limit.',
    ),
  ).toBeVisible();
  expect(screen.getByText(/steady-1\.2k \(k6 load test\), run/)).toHaveTextContent('revision 4, started');
  expect(screen.getByText('Running')).toBeVisible();
  const progress = screen.getByRole('region', { name: 'Progress' });
  expect(within(progress).getByText('1,200')).toBeVisible();
  expect(within(progress).getByText('236 ms')).toBeVisible();
  expect(within(progress).getByText('p95 latency, slowest endpoint, limit 250 ms')).toBeVisible();
  expect(within(progress).getByText('virtual users busy of 300')).toBeVisible();
  const table = screen.getByRole('table', { name: 'Endpoints in the latest live window' });
  expect(within(table).getAllByRole('row')[1]).toHaveTextContent('POST /checkout75%900');
  expect(screen.getByText(/3 more series are recorded but not in the live view/)).toBeVisible();
  expect(screen.getByText('Checked at the end')).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Target runtime' })).toBeVisible();
  expect(screen.getByRole('img', { name: /Heap and RSS: heap 399, RSS 570/ })).toBeVisible();
  // No report or metrics downloads while live.
  expect(screen.queryByRole('button', { name: /download/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /download/i })).not.toBeInTheDocument();
});

it('pauses and resumes the stream on request', async () => {
  const { read } = await running();
  fireEvent.click(screen.getByRole('button', { name: 'Pause stream' }));
  expect(await screen.findByText(/stream paused/)).toBeVisible();
  const calls = read.mock.calls.length;
  await act(async () => new Promise((resolve) => setTimeout(resolve, 2200)));
  expect(read.mock.calls.length).toBe(calls);
  expect(within(screen.getByRole('region', { name: 'Progress' })).getByText('1,200')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Resume stream' }));
  await waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(calls));
});

it('shows reconnecting with stale figures and retries at once', async () => {
  let fail = false;
  let sequence = 0;
  const current = recent();
  const read = vi.spyOn(LiveMetricReads.prototype, 'read').mockImplementation(async () => {
    if (fail) throw new Error('synthetic read failure');
    return liveFrame(current, ++sequence);
  });
  mountLive(routesFor(() => current).client, { run: current });
  await screen.findByRole('heading', { name: 'Holding 1,200 a second' });
  fail = true;
  const banner = await screen.findByText(/^No word for \d+ s$/, undefined, { timeout: 4000 });
  expect(banner).toBeVisible();
  expect(within(screen.getByRole('region', { name: 'Progress' })).getByText('1,200')).toBeVisible();
  const calls = read.mock.calls.length;
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: 'Retry now' }));
  await waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(calls));
  await waitFor(() => expect(screen.queryByText(/^No word for/)).not.toBeInTheDocument());
});

it('cancels from the header through the shared owner and then shows cancelling', async () => {
  const current = recent();
  vi.spyOn(LiveMetricReads.prototype, 'read').mockImplementation(async () => liveFrame(current, 1));
  const cancel = {
    pending: false,
    unknown: false,
    accepted: false,
    message: null,
    request: vi.fn(async () => undefined),
  };
  const view = mountLive(routesFor(() => current).client, { run: current, cancel });
  await screen.findByRole('heading', { name: 'Holding 1,200 a second' });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel run' }));
  expect(cancel.request).toHaveBeenCalledTimes(1);
  view.update({ run: { ...current, version: 2, cancellationRequested: true }, cancel: { ...cancel, accepted: true } });
  expect(await screen.findByRole('heading', { name: 'Cancelling steady-1.2k' })).toBeVisible();
  expect(screen.getByText(/Stopped sending at \d\d:\d\d of 10:00/)).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Cancel run' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Pause stream' })).not.toBeInTheDocument();
});

it('waits for capacity with slot holders and queue position from getRunQueue', async () => {
  const current = liveRun({ state: 'queued', startedAt: null });
  const holder = '44444444-4444-4444-8444-444444444444';
  const fixture = routesFor(
    () => current,
    (request) =>
      request.path.endsWith('/queue')
        ? json({
            scope: current.scope,
            generatedAt: '2026-11-10T23:35:00.000Z',
            runId: current.id,
            state: 'queued',
            waiting: 'backend_queue',
            position: 1,
            slots: { used: 2, runs: 2, exports: 0, configured: 2, effective: 2 },
            holders: [
              { runId: holder, suiteId, suiteName: 'catalog-crawl' },
              { runId: ids.request, suiteId, suiteName: null },
            ],
            otherWorkspaceRuns: 0,
          })
        : undefined,
  );
  mountLive(fixture.client, { run: current });
  expect(await screen.findByText('Queued, first in line.')).toBeVisible();
  expect(screen.getByText(/Both run slots are busy/)).toBeVisible();
  expect(screen.getByRole('link', { name: 'catalog-crawl 4444' })).toBeVisible();
  expect(screen.getByRole('link', { name: /suite 3333 1234/ })).toBeVisible();
  expect(screen.getByRole('heading', { name: 'steady-1.2k is waiting for capacity' })).toBeVisible();
});

it('keeps the compare action disabled with an explanation, and lists script versions', async () => {
  await running();
  const compare = screen.getByRole('button', { name: 'Compare' });
  expect(compare).toHaveAttribute('aria-disabled', 'true');
  expect(compare).toHaveAccessibleDescription(/once this one has finished/);
  fireEvent.click(screen.getByRole('button', { name: 'Script' }));
  const dialog = await screen.findByRole('dialog', { name: 'Script versions' });
  expect(await within(dialog).findByRole('link', { name: /Revision 4/ })).toHaveTextContent(
    /This run.*Latest.*3 runs · by Meera/,
  );
});

it('ends with a hand-off and the p95-rise line mapped to the request name', async () => {
  const current = recent();
  vi.spyOn(LiveMetricReads.prototype, 'read').mockImplementation(async () => liveFrame(current, 1));
  const showResult = vi.fn();
  const fixture = routesFor(() => current);
  const view = mountLive(fixture.client, { run: current, showResult });
  await screen.findByRole('heading', { name: 'Holding 1,200 a second' });
  const ended: Run = { ...current, version: 3, state: 'finished', outcome: 'passed', validationStatus: 'passed' };
  const rise = {
    id: current.id,
    scope: current.scope,
    attemptId: current.activeAttemptId,
    generation: 1,
    manifestDigest: 'c'.repeat(64),
    windows: 120,
    rise: {
      startTimeMs: 60_000,
      endTimeMs: 90_000,
      windows: 30,
      baselineP95Ms: 42.5,
      peakP95Ms: 180.25,
      endpoint: { request: 'r0', share: 0.82, peakP95Ms: 240.5 },
    },
    reason: null,
  };
  const handler = routesFor(
    () => ended,
    (request) => (request.path.endsWith('/latency-attribution') ? json(rise) : undefined),
  );
  view.unmount();
  mountLive(handler.client, { run: ended, showResult });
  expect(
    await screen.findByText('p95 rose for about 30 s, from 42.5 ms to 180 ms, mostly POST /checkout.'),
  ).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Open result' }));
  expect(showResult).toHaveBeenCalledTimes(1);
});

it('shows the restored-backup banner from the session and hides cancel', async () => {
  const current = liveRun({ state: 'queued' });
  const fixture = routesFor(
    () => current,
    (request) => {
      if (request.path.endsWith('/queue')) return new Response(null, { status: 503 });
      return undefined;
    },
  );
  const cancel = {
    pending: false,
    unknown: false,
    accepted: false,
    message: null,
    request: vi.fn(async () => undefined),
  };
  mountLive(
    fixture.client,
    { run: current, cancel },
    { readOnly: true, restoredBackup: { backupId: ids.request, createdAt: '2026-11-12T02:00:00.000Z' } },
  );
  expect(await screen.findByText(/Read-only view of the restored backup from/)).toHaveTextContent('12 Nov');
  expect(screen.queryByRole('button', { name: 'Cancel run' })).not.toBeInTheDocument();
  expect(fixture.records.some((record) => record.path.endsWith('/auth/session'))).toBe(false);
});

it('shows unavailable elapsed time for a valid timestamp the browser cannot parse', async () => {
  const current=liveRun({startedAt:'2026-12-31T23:59:60Z'});
  vi.spyOn(LiveMetricReads.prototype,'read').mockImplementation(async()=>liveFrame(current,1));
  const fixture=routesFor(()=>current);mountLive(fixture.client,{run:current});
  expect(await screen.findByText('Elapsed time unavailable')).toBeVisible();
  expect(screen.getByText(/started 2026-12-31T23:59:60Z/)).toBeVisible();
  expect(screen.queryByText(/NaN/)).toBeNull();
});

it('reads real namespace names once and retries metadata without retiring live metrics', async () => {
  const current=recent();let failed=false;
  vi.spyOn(LiveMetricReads.prototype,'read').mockImplementation(async()=>liveFrame(current,1));
  const fixture=routesFor(()=>current,request=>failed&&request.path.endsWith('/workspaces/'+current.scope.workspaceId)
    ?new Response('',{status:503}):undefined);
  const view=mountLive(fixture.client,{run:current});
  expect(await screen.findByRole('link',{name:'Same workspace'})).toHaveAttribute('href',expect.stringContaining(current.scope.workspaceId));
  expect(fixture.records.filter(request=>request.path.endsWith('/organizations/'+current.scope.organizationId))).toHaveLength(1);
  expect(fixture.records.filter(request=>request.path.endsWith('/workspaces/'+current.scope.workspaceId))).toHaveLength(1);
  failed=true;
  await act(async()=>view.queryClient.invalidateQueries({queryKey:queryKeys.workspace(current.scope.organizationId,current.scope.workspaceId),exact:true}));
  expect(await screen.findByText('Workspace unavailable')).toBeVisible();
  expect(screen.queryByRole('link',{name:'Same workspace'})).toBeNull();
  expect(screen.getByRole('button',{name:'Pause stream'})).toBeEnabled();
  failed=false;fireEvent.click(screen.getByRole('button',{name:'Retry workspace name'}));
  expect(await screen.findByRole('link',{name:'Same workspace'})).toBeVisible();
  expect(fixture.records.every(request=>request.method==='GET')).toBe(true);
});
