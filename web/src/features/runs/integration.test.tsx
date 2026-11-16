// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { validateApi } from '@beetle/contracts/api';
import type { BrowserSession, Suite } from '@beetle/contracts/api';
import { SessionApp } from '../session/index.js';
import { routes } from '../../app/routes.js';
import { ids, json, testClient, mount, settings, revision, suiteId, revisionId, scope, runRead, receipt, runId, deferred, budget, apiError } from './test-fixtures.js';
import type { RequestRecord } from '../../app/test-fixtures.js';
afterEach(cleanup);
const path = routes.suite(ids.a, ids.workspace, suiteId);
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
  return runRead(request);
}
async function submitSaved() {
  fireEvent.click(await screen.findByRole('button', { name: 'View revision 2' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Run saved revision' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Submit run' }));
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
  await screen.findByRole('heading', { name: 'Run detail' }); await screen.findByText('active');
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
  await screen.findByRole('heading', { name: 'Folders' });
  const write = fixture.records.find(record => record.method === 'POST'); expect(write?.signal?.aborted).toBe(true);
  await act(async () => late.resolve(queued(write?.body)));
  expect(screen.queryByRole('heading', { name: 'Run detail' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('link', { name: 'Runs' }));
  expect(await screen.findByRole('link', { name: runId })).toHaveAttribute('href', routes.run(ids.b, ids.workspace, runId));
});
const session: BrowserSession = { scope: 'local-admin', expiresAt: '2027-01-01T00:00:00.000Z', csrfToken: 'c'.repeat(43) };
function paired(handler: (request: RequestRecord) => Response | Promise<Response>, initial = path) {
  const records: RequestRecord[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const record: RequestRecord = { path: url.pathname + url.search, method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : undefined, signal: init?.signal ?? undefined };
    records.push(record); if (records.length > 100) throw new Error('Synthetic request bound exceeded');
    if (record.path.endsWith('/auth/session')) return json(session);
    return handler(record);
  };
  return { records, ...render(<MemoryRouter initialEntries={[initial]}><SessionApp baseUrl="http://localhost" fetch={fetcher} /></MemoryRouter>) };
}
it('retires a delayed submission across sign out and re-pair before its late 202', async () => {
  const late = deferred<Response>();
  const fixture = paired(request => {
    if (request.path.endsWith('/auth/logout')) return json({ loggedOut: true });
    if (request.path.endsWith('/auth/pair')) return json({ ...session, csrfToken: 'd'.repeat(43) });
    return request.method === 'POST' ? late.promise : suiteRead(request);
  });
  await submitSaved(); await waitFor(() => expect(fixture.records.some(record => record.path.endsWith('/runs'))).toBe(true));
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' })); await screen.findByLabelText('Startup token');
  const write = fixture.records.find(record => record.path.endsWith('/runs')); expect(write?.signal?.aborted).toBe(true);
  fireEvent.change(screen.getByLabelText('Startup token'), { target: { value: 'a'.repeat(43) } });
  fireEvent.click(screen.getByRole('button', { name: 'Pair browser' }));
  await screen.findByLabelText('Target URL');
  await act(async () => late.resolve(queued(write?.body)));
  expect(screen.queryByRole('heading', { name: 'Run detail' })).not.toBeInTheDocument();
  expect(screen.getByLabelText('Target URL')).toBeVisible();
  expect(fixture.records.filter(record => record.path.endsWith('/runs'))).toHaveLength(1);
});
it('ends the session for a run-detail 401 without retaining old run content', async () => {
  const fixture = paired(() => json(apiError('unpaired'), 401), routes.run(ids.a, ids.workspace, runId));
  await screen.findByLabelText('Startup token'); expect(screen.queryByRole('heading', { name: 'Run detail' })).not.toBeInTheDocument();
  expect(fixture.records.filter(record => record.path.includes('/runs/'))).toHaveLength(1);
});
it('keeps history readable without requesting unavailable settings or capacity', async () => {
  const fixture = testClient(request => {
    if (request.path.endsWith('/settings') || request.path.endsWith('/capacity')) throw new Error('Unavailable synthetic prerequisite');
    return runRead(request);
  });
  mount(fixture.client, routes.runs(ids.a, ids.workspace)); await screen.findByRole('link', { name: runId });
  expect(fixture.records).toHaveLength(1);
});
