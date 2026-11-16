// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { validate } from '@beetle/contracts';
import type { Run, RunResultSnapshot } from '@beetle/contracts/api';
import passed from '../../../../contracts/fixtures/valid/passed-result.json' with { type: 'json' };
import { ApiContext } from '../../app/api.js';
import { createQueryClient, queryKeys } from '../../app/queries.js';
import { Runs } from './index.js';
import { apiError, deferred, ids, json, resultSnapshot, run, runId, testClient } from './test-fixtures.js';

afterEach(() => { cleanup(); vi.useRealTimers(); });
function evidence(current = run(), relativePath = 'reports/current.json'): RunResultSnapshot {
  const result = validate('EngineResult', { ...structuredClone(passed), organizationId: current.scope.organizationId,
    workspaceId: current.scope.workspaceId, attemptId: current.activeAttemptId,
    artifacts: [{ ...passed.artifacts[0], relativePath }] });
  if (!result.ok) throw new Error('Invalid synthetic EngineResult');
  return { ...resultSnapshot(current), result: result.value };
}
function mountDetail(api: ReturnType<typeof testClient>['client'], initial = run()) {
  const client = createQueryClient();
  const surface = (current: Run) => <MemoryRouter><ApiContext.Provider value={api}><QueryClientProvider client={client}>
    <Runs organizationId={current.scope.organizationId} workspaceId={current.scope.workspaceId} runId={current.id} />
  </QueryClientProvider></ApiContext.Provider></MemoryRouter>;
  const view = render(surface(initial));
  return { ...view, client, select: (current: Run) => view.rerender(surface(current)) };
}
function panel() { return within(screen.getByRole('region', { name: 'Run result' })); }
function resultRequests(fixture: ReturnType<typeof testClient>) { return fixture.records.filter(record => record.path.endsWith('/result')); }
const unavailable = /Metrics and result artifacts are unavailable/;

it('reads through the generated client and keeps sealed evidence provisional until authoritative terminal state', async () => {
  let current: Run = { ...run(), state: 'finalizing' };
  const held = deferred<Response>();
  const fixture = testClient(request => request.path.endsWith('/result') ? held.promise : json(current));
  mountDetail(fixture.client);
  expect(await panelWhenReady()).toHaveTextContent('Loading result details');
  expect(screen.getAllByText('pending')).toHaveLength(2);
  await act(async () => held.resolve(json(evidence(current))));
  expect(await panel().findByText('reports/current.json')).toBeVisible();
  expect(panel().getByText(/Awaiting application finalization/)).toBeVisible();
  expect(panel().getByText('Application outcome').nextElementSibling).toHaveTextContent('pending');
  current = { ...current, version: 2, state: 'finished', outcome: 'failed', validationStatus: 'passed' };
  fireEvent.click(screen.getByRole('button', { name: 'Refresh run' }));
  await waitFor(() => expect(panel().queryByText(/Awaiting application finalization/)).not.toBeInTheDocument());
  expect(panel().getByText('Application outcome').nextElementSibling).toHaveTextContent('failed');
  expect(panel().getByText('Engine-reported outcome').nextElementSibling).toHaveTextContent('passed');
  expect(resultRequests(fixture)).toHaveLength(1);
});
async function panelWhenReady() { return screen.findByRole('region', { name: 'Run result' }); }

it('keeps null unavailable, then polls the current attempt without manufacturing an empty result', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  let reads = 0;
  const fixture = testClient(request => request.path.endsWith('/result')
    ? json(++reads === 1 ? resultSnapshot() : evidence()) : json(run()));
  mountDetail(fixture.client);
  expect(await screen.findByText(unavailable)).toBeVisible();
  expect(panel().queryByText('No artifacts declared.')).not.toBeInTheDocument();
  expect(panel().queryByText('Required assertions')).not.toBeInTheDocument();
  await act(() => vi.advanceTimersByTimeAsync(2000));
  expect(await panel().findByText('reports/current.json')).toBeVisible();
  expect(reads).toBe(2); expect(panel().getByText('Provisional')).toBeVisible();
});

it('rechecks a null source when authoritative finalization becomes terminal and stops interval reads', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  let current = run(); let adopted = false;
  const fixture = testClient(request => request.path.endsWith('/result')
    ? json(adopted ? evidence(current) : resultSnapshot(current)) : json(current));
  mountDetail(fixture.client); await screen.findByText(unavailable);
  current = { ...current, version: 2, state: 'finished', outcome: 'passed', validationStatus: 'passed' }; adopted = true;
  fireEvent.click(screen.getByRole('button', { name: 'Refresh run' }));
  expect(await panel().findByText('reports/current.json')).toBeVisible();
  expect(panel().queryByText('Provisional')).not.toBeInTheDocument();
  const reads = resultRequests(fixture).length;
  await act(() => vi.advanceTimersByTimeAsync(6000));
  expect(resultRequests(fixture)).toHaveLength(reads);
});

it('rechecks an older in-flight null response arriving after authoritative terminal state', async () => {
  let current = run(); let reads = 0;
  const older = deferred<Response>();
  const fixture = testClient(request => request.path.endsWith('/result')
    ? ++reads === 1 ? older.promise : json(evidence(current)) : json(current));
  mountDetail(fixture.client);
  await waitFor(() => expect(resultRequests(fixture)).toHaveLength(1));
  current = { ...current, version: 2, state: 'finished', outcome: 'passed', validationStatus: 'passed' };
  fireEvent.click(screen.getByRole('button', { name: 'Refresh run' }));
  await waitFor(() => expect(screen.getByText('State').nextElementSibling).toHaveTextContent('finished'));
  expect(reads).toBe(1);
  await act(async () => older.resolve(json(resultSnapshot())));
  expect(await screen.findByText('reports/current.json')).toBeVisible();
  expect(reads).toBe(2);
  expect(panel().queryByText('Provisional')).not.toBeInTheDocument();
});

const switches = {
  organization: (current: Run): Run => ({ ...current, scope: { ...current.scope, organizationId: ids.b } }),
  workspace: (current: Run): Run => ({ ...current, scope: { ...current.scope, workspaceId: ids.b } }),
  run: (current: Run): Run => ({ ...current, id: ids.b }),
  attempt: (current: Run): Run => ({ ...current, version: 2, activeAttemptId: ids.b }),
};
it.each(Object.keys(switches) as (keyof typeof switches)[])('removes ready evidence immediately on %s switch and reads the new identity', async boundary => {
  let current = run(); const fresh = deferred<Response>(); let reads = 0;
  const fixture = testClient(request => request.path.endsWith('/result')
    ? ++reads === 1 ? json(evidence(current, 'reports/retired.json')) : fresh.promise : json(current));
  const view = mountDetail(fixture.client);
  await screen.findByText('reports/retired.json');
  current = switches[boundary](current);
  if (boundary === 'attempt') fireEvent.click(screen.getByRole('button', { name: 'Refresh run' }));
  else view.select(current);
  await waitFor(() => expect(panel().getByText(/Loading result details/)).toBeVisible());
  expect(screen.queryByText('reports/retired.json')).not.toBeInTheDocument();
  await waitFor(() => expect(resultRequests(fixture)).toHaveLength(2));
  await act(async () => fresh.resolve(json(evidence(current, 'reports/fresh.json'))));
  expect(await screen.findByText('reports/fresh.json')).toBeVisible();
  expect(view.client.getQueryCache().findAll().filter(query => query.queryKey.includes('result'))).toHaveLength(1);
});

it.each(Object.keys(switches).flatMap(boundary => ['success', 'error'].map(reply => [boundary, reply] as const)))(
  'aborts and fences a late %s result %s after retirement', async (boundary, reply) => {
    let current = run(); const retired = current; const late = deferred<Response>(); const fresh = deferred<Response>(); let reads = 0;
    const fixture = testClient(request => request.path.endsWith('/result') ? ++reads === 1 ? late.promise : fresh.promise : json(current));
    const view = mountDetail(fixture.client);
    await waitFor(() => expect(resultRequests(fixture)).toHaveLength(1));
    const original = resultRequests(fixture)[0]!;
    current = switches[boundary as keyof typeof switches](current);
    if (boundary === 'attempt') fireEvent.click(screen.getByRole('button', { name: 'Refresh run' }));
    else view.select(current);
    await waitFor(() => expect(resultRequests(fixture)).toHaveLength(2));
    expect(original.signal?.aborted).toBe(true);
    await act(async () => late.resolve(reply === 'success' ? json(evidence(retired, 'reports/retired.json')) : json(apiError('storage_unavailable'), 503)));
    expect(panel().getByText(/Loading result details/)).toBeVisible();
    expect(panel().queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('reports/retired.json')).not.toBeInTheDocument();
    await act(async () => fresh.resolve(json(evidence(current))));
    expect(await screen.findByText('reports/current.json')).toBeVisible();
    expect(panel().queryByRole('alert')).not.toBeInTheDocument();
  });

it('aborts/removes an unresolved result on unmount, and a late reply cannot recreate its cache', async () => {
  const late = deferred<Response>();
  const fixture = testClient(request => request.path.endsWith('/result') ? late.promise : json(run()));
  const view = mountDetail(fixture.client);
  await waitFor(() => expect(resultRequests(fixture)).toHaveLength(1));
  view.unmount(); expect(resultRequests(fixture)[0]!.signal?.aborted).toBe(true);
  await act(async () => late.resolve(json(evidence())));
  expect(view.client.getQueryCache().findAll({ queryKey: queryKeys.runs(ids.a, ids.workspace) })).toHaveLength(0);
  expect(view.client.isFetching()).toBe(0);
});

it('keeps an explicitly cancelled query pending without turning its late reply into success or an error', async () => {
  const late = deferred<Response>();
  const fixture = testClient(request => request.path.endsWith('/result') ? late.promise : json(run()));
  const view = mountDetail(fixture.client);
  await waitFor(() => expect(resultRequests(fixture)).toHaveLength(1));
  await act(() => view.client.cancelQueries({ queryKey: [...queryKeys.run(ids.a, ids.workspace, runId), 'result'] }));
  expect(resultRequests(fixture)[0]!.signal?.aborted).toBe(true);
  await act(async () => late.resolve(json(evidence())));
  expect(panel().getByText(/Loading result details/)).toBeVisible();
  expect(panel().queryByRole('alert')).not.toBeInTheDocument();
  expect(panel().queryByText('reports/current.json')).not.toBeInTheDocument();
});

it('shows result HTTP errors independently of the authoritative Run and stops automatic result retries', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  const fixture = testClient(request => request.path.endsWith('/result') ? json(apiError('storage_unavailable'), 503) : json(run()));
  mountDetail(fixture.client);
  expect(await screen.findByRole('alert')).toHaveTextContent('Result details could not be loaded.');
  expect(screen.getByText('State').nextElementSibling).toHaveTextContent('queued');
  await act(() => vi.advanceTimersByTimeAsync(6000));
  expect(resultRequests(fixture)).toHaveLength(1);
  expect(panel().queryByText('Required assertions')).not.toBeInTheDocument();
});

it.each(['scope', 'id', 'attempt', 'engine'] as const)('rejects a result with a different %s without showing its declarations', async boundary => {
  const snapshot = evidence();
  if (boundary === 'scope') snapshot.scope = { ...snapshot.scope, organizationId: ids.b };
  if (boundary === 'id') snapshot.id = ids.b;
  if (boundary === 'attempt') {
    snapshot.activeAttemptId = ids.b; snapshot.result = { ...snapshot.result!, attemptId: ids.b };
  }
  if (boundary === 'engine') snapshot.result = { ...snapshot.result!, engineId: 'other' };
  const fixture = testClient(request => json(request.path.endsWith('/result') ? snapshot : run()));
  mountDetail(fixture.client);
  if (boundary === 'scope' || boundary === 'id') expect(await screen.findByRole('alert')).toHaveTextContent('Result details could not be loaded.');
  else expect(await screen.findByText(unavailable)).toBeVisible();
  expect(panel().queryByText('reports/current.json')).not.toBeInTheDocument();
  expect(panel().queryByText('Required assertions')).not.toBeInTheDocument();
});
