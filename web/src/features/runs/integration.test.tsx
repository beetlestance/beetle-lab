// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import overview from '../../../../contracts/fixtures/api/valid/workspace-overview.json' with {type:'json'};
import { afterEach, beforeAll, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { validateApi } from '@beetle/contracts/api';
import type { BrowserSession, Suite } from '@beetle/contracts/api';
import { SessionApp } from '../session/index.js';
import { routes } from '../../app/routes.js';
import { ids, json, testClient, mount, settings, revision, suiteId, revisionId, scope, runRead, receipt, runId, deferred, budget, apiError } from './test-fixtures.js';
import type { RequestRecord } from '../../app/test-fixtures.js';
afterEach(cleanup);
// Compile the two lazy views before the bounded functional assertions begin.
// A broken module still rejects setup; no API response or application behavior is mocked here.
beforeAll(async()=>{await import('../suites/index.js');await import('../workspaces/index.js');});
// The draft editor (Target URL) is on the Edit tab; Start run launches the saved revision from the header.
const path = `${routes.suite(ids.a, ids.workspace, suiteId)}?tab=edit`;
function suiteRead(request: RequestRecord) {
  const organizationId = request.path.includes(ids.b) ? ids.b : ids.a;
  const saved = revision(organizationId);
  const suite: Suite = { id: suiteId, scope: saved.scope, version: 1, name: 'Same suite', folderId: ids.root, currentRevisionId: revisionId };
  if (request.path.endsWith(`/suites/${suiteId}`)) return json(suite);
  if (request.path.includes(`/suites/${suiteId}/revisions?`)) return json({ scope: saved.scope, suiteId, items: [
    { id: saved.id, scope: saved.scope, suiteId, ordinal: saved.ordinal, engineId: saved.engineId, configVersion: saved.configVersion,
      digest: saved.digest, preflightStatus: saved.preflightStatus },
  ], nextCursor: null });
  if (request.path.endsWith(`/revisions/${revisionId}`)) return json(saved);
  if (request.path.endsWith('/settings')) return json(settings(organizationId));
  if (request.path.endsWith('/overview')) return json({...overview,scope:{...scope,organizationId},counts:{...overview.counts,runs:1,finished:1,suites:1},recent:[{id:runId,suiteId,revisionId,requestedAt:'2026-11-10T00:00:00.000Z',state:'finished',outcome:'passed'}]});
  return runRead(request);
}
async function submitSaved() {
  fireEvent.click(await screen.findByRole('button', { name: 'Start run' }));
  const dialog = await screen.findByRole('dialog', { name: 'Start Same suite' });
  await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Start run' })).toBeEnabled());
  fireEvent.click(within(dialog).getByRole('button', { name: 'Start run' }));
}
function queued(body: unknown) {
  const checked = validateApi('CreateRunRequest', body);
  if (!checked.ok) throw new Error('Invalid synthetic request');
  return json(receipt(checked.value), 202);
}
it('launches current saved revision without using edited draft text and reads the latest detail after receipt', async () => {
  const fixture = testClient(request => {
    if (request.method === 'POST') return queued(request.body);
    if (request.path.endsWith(`/runs/${runId}`)) return json({ ...receipt({ scope, requestId: ids.request, revisionId, engineProfile: 'k6',
      budget,
      executionPolicy: { mode: 'parallel', preferIdle: false } }), version: 3, state: 'active' });
    return suiteRead(request);
  });
  mount(fixture.client, path);
  fireEvent.change(await screen.findByLabelText('Target URL'), { target: { value: 'http://edited.invalid' } });
  await submitSaved();
  await screen.findByRole('heading', { name: 'Run detail' }); await screen.findAllByText('Starting');
  const body = fixture.records.find(record => record.method === 'POST')?.body;
  expect(body?.revisionId).toBe(revisionId); expect(body).not.toHaveProperty('config');
  expect(fixture.records.filter(record => record.path.endsWith(`/runs/${runId}`))).toHaveLength(1);
});
it('fences late creation after switching organization with identical workspace and revision IDs', async () => {
  const late = deferred<Response>();
  const fixture = testClient(request => request.method === 'POST' ? late.promise : suiteRead(request));
  mount(fixture.client, path); await submitSaved();
  await waitFor(() => expect(fixture.records.some(record => record.method === 'POST')).toBe(true));
  fireEvent.click(screen.getByRole('button', { name: 'Switch workspace B' }));
  expect(await screen.findByRole('link',{name:'All runs'})).toHaveAttribute('href',routes.runs(ids.b,ids.workspace));
  const write = fixture.records.find(record => record.method === 'POST'); expect(write?.signal?.aborted).toBe(true);
  await act(async () => late.resolve(queued(write?.body)));
  expect(screen.queryByRole('heading', { name: 'Run detail' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('link', { name: 'All runs' }));
  expect(await screen.findByRole('link', { name: new RegExp(runId) })).toHaveAttribute('href', routes.run(ids.b, ids.workspace, runId));
});
const session: BrowserSession = { scope: 'local-admin', expiresAt: '2027-01-01T00:00:00.000Z', csrfToken: 'c'.repeat(43) };
function paired(handler: (request: RequestRecord) => Response | Promise<Response>, initial = path, readSession=()=>json(session)) {
  const records: RequestRecord[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const record: RequestRecord = { path: url.pathname + url.search, method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : undefined, signal: init?.signal ?? undefined };
    records.push(record); if (records.length > 100) throw new Error('Synthetic request bound exceeded');
    if (record.path.endsWith('/auth/session')) return readSession();
    return handler(record);
  };
  return { records, ...render(<MemoryRouter initialEntries={[initial]}><SessionApp baseUrl="http://localhost" fetch={fetcher} autoOpen={false} /></MemoryRouter>) };
}
it('retires a delayed submission across sign out and re-pair before its late 202', async () => {
  const late = deferred<Response>();
  let connected=true;
  const replacement={...session,csrfToken:'d'.repeat(43)};
  const fixture = paired(request => {
    if (request.path.endsWith('/auth/logout')) {connected=false;return json({ loggedOut: true });}
    if (request.path.endsWith('/auth/pair')) {connected=true;return json(replacement);}
    return request.method === 'POST' ? late.promise : suiteRead(request);
  },path,()=>connected?json(replacement):json(apiError('unpaired'),401));
  await submitSaved(); await waitFor(() => expect(fixture.records.some(record => record.path.endsWith('/runs'))).toBe(true));
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' })); await screen.findByRole('heading',{name:'You are signed out'});
  const write = fixture.records.find(record => record.path.endsWith('/runs')); expect(write?.signal?.aborted).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:'Reconnect'}));
  fireEvent.change(await screen.findByLabelText('Pairing token'), { target: { value: 'a'.repeat(43) } });
  fireEvent.click(screen.getByRole('button', { name: 'Pair' }));
  await screen.findByLabelText('Target URL');
  await act(async () => late.resolve(queued(write?.body)));
  expect(screen.queryByRole('heading', { name: 'Run detail' })).not.toBeInTheDocument();
  expect(screen.getByLabelText('Target URL')).toBeVisible();
  expect(fixture.records.filter(record => record.path.endsWith('/runs'))).toHaveLength(1);
});
it('ends the session for a run-detail 401 without retaining old run content', async () => {
  const fixture = paired(() => json(apiError('unpaired'), 401), routes.run(ids.a, ids.workspace, runId));
  await screen.findByRole('heading',{name:'Your session ended'}); expect(screen.queryByRole('heading', { name: 'Run detail' })).not.toBeInTheDocument();
  expect(fixture.records.filter(record => record.path.includes('/runs/'))).toHaveLength(1);
});
it('keeps history readable without requesting unavailable settings or capacity', async () => {
  const fixture = testClient(request => {
    if (request.path.endsWith('/settings') || request.path.endsWith('/capacity')) throw new Error('Unavailable synthetic prerequisite');
    return runRead(request);
  });
  mount(fixture.client, routes.runs(ids.a, ids.workspace)); await screen.findByRole('link', { name: new RegExp(runId) });
  expect(fixture.records.filter(record => !record.path.includes('/suites?'))).toHaveLength(1);
});
