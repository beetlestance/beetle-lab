// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import type { InputRecord, Suite, SuiteRevision } from '@beetle/contracts/api';
import { ids, json, mount, readNamespace, testClient } from '../../app/test-fixtures.js';
import type { RequestRecord } from '../../app/test-fixtures.js';
import { App } from '../../app/App.js';
import { routes } from '../../app/routes.js';
import { parseDraft, starter } from '../suites/draft.js';

afterEach(cleanup);
const scope = { kind: 'workspace' as const, organizationId: ids.a, workspaceId: ids.workspace };
const suiteId = '11111111-1111-4111-8111-111111111111';
const revisionId = '22222222-2222-4222-8222-222222222222';
const usersId = '55555555-5555-4555-8555-555555555555';
const cartId = '66666666-6666-4666-8666-666666666666';
// The editor lives on the suite page's Edit tab.
const path = `${routes.suite(ids.a, ids.workspace, suiteId)}?tab=edit`;
function input(id: string, name: string, state: InputRecord['state'] = 'published'): InputRecord {
  return { id, scope, name, folderId: ids.root, sha256: 'b'.repeat(64), bytes: 120, offset: 120, version: 1, state, reason: null };
}
function suite(): Suite {
  return { id: suiteId, scope, name: 'Checkout', version: 1, folderId: ids.root, currentRevisionId: revisionId };
}
function revision(config = parseDraft(starter())): SuiteRevision {
  return { id: revisionId, scope, suiteId, ordinal: 4, engineId: 'k6', configVersion: 1, digest: 'a'.repeat(64), config, inputManifest: [], preflightStatus: 'passed' };
}
function reader(config?: Record<string, unknown>, inputs = [input(usersId, 'users.csv'), input(cartId, 'cart-item.json')]) {
  return (request: RequestRecord) => {
    if (request.path.endsWith(`/suites/${suiteId}`)) return json(suite());
    if (request.path.includes(`/suites/${suiteId}/revisions?`)) return json({ scope, suiteId, items: [], nextCursor: null });
    if (request.path.endsWith(`/revisions/${revisionId}`)) return json(revision(config));
    if (request.path.includes('/inputs?')) return json({ scope, items: inputs, nextCursor: null });
    const record = inputs.find((item) => request.path.endsWith(`/inputs/${item.id}`));
    if (record) return json(record);
    if (request.path.includes('/runs?')) return json({ scope, items: [], nextCursor: null });
    return readNamespace(request);
  };
}
const draft = () =>
  parseDraft((screen.getByRole('textbox', { name: 'Complete configuration JSON' }) as HTMLTextAreaElement).value);
const openJson = () => fireEvent.click(screen.getByRole('radio', { name: 'Complete configuration JSON' }));

it('edits weight, body, checks, thresholds and datasets through the form and keeps them in the JSON', async () => {
  mount(testClient(reader()).client, path);
  fireEvent.change(await screen.findByRole('textbox', { name: 'Request 1 Weight' }), { target: { value: '34' } });
  const body = screen.getByRole('combobox', { name: 'Request 1 Body from input' });
  await within(body).findByRole('option', { name: 'cart-item.json' });
  fireEvent.change(body, { target: { value: cartId } });
  fireEvent.click(screen.getByRole('button', { name: 'Add check to request 1' }));
  await screen.findByRole('heading', { name: 'Request 1: Get' });
  fireEvent.change(screen.getByRole('textbox', { name: 'Check 1 value' }), { target: { value: '201' } });
  fireEvent.click(screen.getByRole('button', { name: 'Back to all requests' }));
  expect(await screen.findByText('status is 201')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Add threshold' }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Threshold 1 measure' }), { target: { value: 'failed' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Threshold 1 value, percent' }), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add dataset' }));
  openJson();
  const config = draft();
  const request = (config.requests as Record<string, unknown>[])[0]!;
  expect(request.body).toEqual({ kind: 'input', input: { id: cartId, sha256: 'b'.repeat(64), bytes: 120 }, format: 'json' });
  expect(request.assertions).toEqual([{ id: 'check', required: true, kind: 'statusEq', value: 201 }]);
  expect((config.selections as { entries: { weight: number }[] }[])[0]!.entries[0]!.weight).toBe(34);
  expect((config.loadPlan as { slos: unknown[] }).slos).toEqual([
    { id: 'slo', metric: 'http_req_failed', stat: 'rate', operator: '<', value: 0.01 },
  ]);
  expect(config.datasets).toEqual([
    { id: 'users', selection: 'byVu', kind: 'csv', input: { id: usersId, sha256: 'b'.repeat(64), bytes: 120 } },
  ]);
});

it('names a deleted input file and refuses to save until it is replaced', async () => {
  const base = parseDraft(starter());
  const config = { ...base, datasets: [{ id: 'users', selection: 'byVu', kind: 'csv', input: { id: usersId, sha256: 'b'.repeat(64), bytes: 120 } }] };
  const fixture = testClient(reader(config, [input(usersId, 'users.csv', 'deleted')]));
  mount(fixture.client, path);
  await screen.findByText('Fix 1 thing before saving');
  fireEvent.click(screen.getByRole('button', { name: 'users.csv was deleted.' }));
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Dataset 1 source' })));
  fireEvent.click(screen.getByRole('button', { name: 'Save revision' }));
  expect(fixture.records.filter((record) => record.method === 'POST')).toHaveLength(0);
});

it('maps server field errors to the fields and sends the revision message', async () => {
  const fixture = testClient((request) => {
    if (request.method === 'POST')
      return json({ code: 'invalid_value', message: 'Invalid value', retryable: false, requestId: ids.request, fields: [{ path: '/config/requests/0/path', code: 'format' }] }, 400);
    return reader()(request);
  });
  mount(fixture.client, path);
  fireEvent.change(await screen.findByRole('textbox', { name: 'What changed' }), { target: { value: 'raised the rate to 1,500' } });
  expect(screen.getByRole('heading', { name: 'Save as revision 5' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save revision' }));
  const problem = await screen.findByRole('button', { name: 'Request 1 (GET /) path is not in the expected format.' });
  fireEvent.click(problem);
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Request 1 Path' })));
  const post = fixture.records.find((record) => record.method === 'POST');
  expect(post?.body).toMatchObject({ message: 'raised the rate to 1,500', expectedVersion: 1 });
});

it('switches executor to the ramp, hold and drain view and edits run setup', async () => {
  mount(testClient(reader()).client, path);
  fireEvent.change(await screen.findByRole('combobox', { name: 'Executor' }), { target: { value: 'ramping-arrival-rate' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Peak requests a second' }), { target: { value: '1200' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Hold, seconds' }), { target: { value: '480' } });
  expect(screen.getByText('in total, 3 stages', { exact: false })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('radio', { name: 'Run setup' }));
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Wait until the target answers before starting load' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Probe path' }), { target: { value: '/ready' } });
  openJson();
  const config = draft();
  const scenario = (config.loadPlan as { scenarios: Record<string, unknown>[] }).scenarios[0]!;
  expect(scenario).toMatchObject({ id: 'main', executor: 'ramping-arrival-rate', startRate: 1, timeUnit: '1s' });
  expect(scenario.stages).toEqual([
    { duration: '60s', target: 1200 },
    { duration: '480s', target: 1200 },
    { duration: '60s', target: 1 },
  ]);
  expect(config.readiness).toMatchObject({ path: '/ready', expectedStatus: 200 });
});

it('discards edits back to the saved revision', async () => {
  mount(testClient(reader()).client, path);
  const target = await screen.findByRole('textbox', { name: 'Target URL' });
  const discard = screen.getByRole('button', { name: 'Discard changes' });
  expect(discard).toBeDisabled();
  fireEvent.change(target, { target: { value: 'http://changed.invalid' } });
  fireEvent.click(discard);
  expect(target).toHaveValue('http://target.invalid');
  expect(discard).toBeDisabled();
});

function HistoryDriver() {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <div>
      <output aria-label="Current search">{location.search}</output>
      <button onClick={() => void navigate(-1)}>History back</button>
      <button onClick={() => void navigate(1)}>History forward</button>
    </div>
  );
}
function mountAt(initial: string) {
  render(
    <MemoryRouter initialEntries={[initial]}>
      <HistoryDriver />
      <App apiClient={testClient(reader()).client} />
    </MemoryRouter>,
  );
}
const search = () => screen.getByRole('status', { name: 'Current search' }).textContent;

it('opens the request and Run setup views from deep links', async () => {
  mountAt(routes.suitePage(ids.a, ids.workspace, suiteId, { tab: 'edit', view: 'form', request: 'get' }));
  expect(await screen.findByRole('heading', { name: 'Request 1: Get' })).toBeInTheDocument();
  cleanup();
  mountAt(routes.suitePage(ids.a, ids.workspace, suiteId, { tab: 'edit', view: 'run-setup' }));
  expect(await screen.findByRole('checkbox', { name: 'Wait until the target answers before starting load' })).toBeInTheDocument();
});

it('writes the editor view to the URL so back and forward move between views', async () => {
  mountAt(path);
  fireEvent.click(await screen.findByRole('button', { name: 'Add check to request 1' }));
  await screen.findByRole('heading', { name: 'Request 1: Get' });
  expect(search()).toBe('?tab=edit&request=get');
  fireEvent.click(screen.getByRole('radio', { name: 'Run setup' }));
  await screen.findByRole('checkbox', { name: 'Wait until the target answers before starting load' });
  expect(search()).toBe('?tab=edit&view=run-setup');
  openJson();
  expect(search()).toBe('?tab=edit&view=json');
  fireEvent.click(screen.getByRole('button', { name: 'History back' }));
  expect(await screen.findByRole('checkbox', { name: 'Wait until the target answers before starting load' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'History back' }));
  expect(await screen.findByRole('heading', { name: 'Request 1: Get' })).toBeInTheDocument();
  // The check added before navigating is still in the draft.
  expect(screen.getByRole('textbox', { name: 'Check 1 value' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'History forward' }));
  expect(await screen.findByRole('checkbox', { name: 'Wait until the target answers before starting load' })).toBeInTheDocument();
});
