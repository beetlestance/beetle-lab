// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { validateApi } from '@beetle/contracts/api';
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
  return {
    id,
    scope,
    name,
    folderId: ids.root,
    sha256: 'b'.repeat(64),
    bytes: 120,
    offset: 120,
    version: 1,
    state,
    reason: null,
  };
}
function suite(): Suite {
  return { id: suiteId, scope, name: 'Checkout', version: 1, folderId: ids.root, currentRevisionId: revisionId };
}
function revision(config = parseDraft(starter())): SuiteRevision {
  return {
    id: revisionId,
    scope,
    suiteId,
    ordinal: 4,
    engineId: 'k6',
    configVersion: 1,
    digest: 'a'.repeat(64),
    config,
    inputManifest: [],
    preflightStatus: 'passed',
  };
}
function reader(
  config?: Record<string, unknown>,
  inputs = [input(usersId, 'users.csv'), input(cartId, 'cart-item.json')],
) {
  return (request: RequestRecord) => {
    if (request.path.endsWith(`/suites/${suiteId}`)) return json(suite());
    if (request.path.includes(`/suites/${suiteId}/revisions?`))
      return json({ scope, suiteId, items: [], nextCursor: null });
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
const openJson = () => {
  const done = screen.queryByRole('button', { name: 'Done' });
  if (done) fireEvent.click(done);
  fireEvent.click(screen.getByRole('radio', { name: 'Complete configuration JSON' }));
};

it('edits weight, body, checks, thresholds and datasets through the form and keeps them in the JSON', async () => {
  mount(testClient(reader()).client, path);
  fireEvent.change(await screen.findByRole('textbox', { name: 'Request 1 Weight' }), { target: { value: '34' } });
  const body = screen.getByRole('combobox', { name: 'Request 1 Body from input' });
  await within(body).findByRole('option', { name: 'cart-item.json' });
  fireEvent.change(body, { target: { value: cartId } });
  fireEvent.click(screen.getByRole('button', { name: 'Add check to request 1' }));
  await screen.findByRole('heading', { name: 'Request: GET /' });
  fireEvent.change(screen.getByRole('textbox', { name: 'Check 1 value' }), { target: { value: '201' } });
  fireEvent.click(screen.getByRole('button', { name: 'Back to requests' }));
  expect(await screen.findByText('status is 201')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Add threshold' }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Threshold 1 measure' }), { target: { value: 'failed' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Threshold 1 value, percent' }), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add dataset' }));
  openJson();
  const config = draft();
  const request = (config.requests as Record<string, unknown>[])[0]!;
  expect(request.body).toEqual({
    kind: 'input',
    input: { id: cartId, sha256: 'b'.repeat(64), bytes: 120 },
    format: 'json',
  });
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
  const config = {
    ...base,
    datasets: [
      { id: 'users', selection: 'byVu', kind: 'csv', input: { id: usersId, sha256: 'b'.repeat(64), bytes: 120 } },
    ],
  };
  const fixture = testClient(reader(config, [input(usersId, 'users.csv', 'deleted')]));
  mount(fixture.client, path);
  await screen.findByText('Fix 1 thing before saving');
  fireEvent.click(screen.getByRole('button', { name: 'users.csv was deleted.' }));
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Dataset 1 rows from' })),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save revision' }));
  expect(fixture.records.filter((record) => record.method === 'POST')).toHaveLength(0);
});

it('maps server field errors to the fields and sends the revision message', async () => {
  const fixture = testClient((request) => {
    if (request.method === 'POST')
      return json(
        {
          code: 'invalid_value',
          message: 'Invalid value',
          retryable: false,
          requestId: ids.request,
          fields: [{ path: '/config/requests/0/path', code: 'format' }],
        },
        400,
      );
    return reader()(request);
  });
  mount(fixture.client, path);
  fireEvent.change(await screen.findByRole('textbox', { name: 'What changed' }), {
    target: { value: 'raised the rate to 1,500' },
  });
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
  fireEvent.change(await screen.findByRole('combobox', { name: 'Executor' }), {
    target: { value: 'ramping-arrival-rate' },
  });
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
  expect(screen.getByRole('textbox', { name: 'Target URL' })).toHaveValue('http://target.invalid');
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
  expect(await screen.findByRole('heading', { name: 'Request: GET /' })).toBeInTheDocument();
  cleanup();
  mountAt(routes.suitePage(ids.a, ids.workspace, suiteId, { tab: 'edit', view: 'run-setup' }));
  expect(
    await screen.findByRole('checkbox', { name: 'Wait until the target answers before starting load' }),
  ).toBeInTheDocument();
});

it('writes the editor view to the URL so back and forward move between views', async () => {
  mountAt(path);
  fireEvent.click(await screen.findByRole('button', { name: 'Add check to request 1' }));
  await screen.findByRole('heading', { name: 'Request: GET /' });
  expect(search()).toBe('?tab=edit&request=get');
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Run setup' }));
  await screen.findByRole('checkbox', { name: 'Wait until the target answers before starting load' });
  expect(search()).toBe('?tab=edit&view=run-setup');
  openJson();
  expect(search()).toBe('?tab=edit&view=json');
  fireEvent.click(screen.getByRole('button', { name: 'History back' }));
  fireEvent.click(screen.getByRole('button', { name: 'History back' }));
  expect(
    await screen.findByRole('checkbox', { name: 'Wait until the target answers before starting load' }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'History back' }));
  fireEvent.click(screen.getByRole('button', { name: 'History back' }));
  expect(await screen.findByRole('heading', { name: 'Request: GET /' })).toBeInTheDocument();
  // The check added before navigating is still in the draft.
  expect(screen.getByRole('textbox', { name: 'Check 1 value' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'History forward' }));
  fireEvent.click(screen.getByRole('button', { name: 'History forward' }));
  expect(
    await screen.findByRole('checkbox', { name: 'Wait until the target answers before starting load' }),
  ).toBeInTheDocument();
});

it('saves Name, Folder, description and target in one revision request and refreshes the real header facts', async () => {
  const nextId = '33333333-3333-4333-8333-333333333333';
  let currentSuite = suite();
  let currentRevision = revision();
  const fixture = testClient((request) => {
    if (request.method === 'POST') {
      const body = validateApi('CreateSuiteRevisionRequest', request.body);
      if (!body.ok) throw Error('Invalid submitted revision');
      const metadata = body.value.metadata;
      currentRevision = { ...currentRevision, id: nextId, ordinal: 5, config: body.value.config };
      currentSuite = { ...currentSuite, ...metadata, version: 2, currentRevisionId: nextId };
      return json(currentRevision, 201);
    }
    if (request.path.endsWith('/suites/' + suiteId)) return json(currentSuite);
    if (request.path.endsWith('/revisions/' + nextId)) return json(currentRevision);
    if (request.path.includes('/folders?'))
      return json({
        scope,
        items: [
          { id: ids.root, scope, name: 'Root', version: 1, parentFolderId: null, displayPath: [] },
          {
            id: ids.folder,
            scope,
            name: 'Destination',
            version: 1,
            parentFolderId: ids.root,
            displayPath: ['Destination'],
          },
        ],
        nextCursor: null,
      });
    return reader()(request);
  });
  mount(fixture.client, path);
  expect(await screen.findByRole('textbox', { name: 'Name' })).toHaveValue('Checkout');
  expect(screen.getByRole('button', { name: 'Save revision' })).toBeDisabled();
  fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Renamed checkout' } });
  const folders = screen.getByRole('combobox', { name: 'Folder' });
  await within(folders).findByRole('option', { name: 'Destination' });
  fireEvent.change(folders, { target: { value: ids.folder } });
  fireEvent.change(screen.getByRole('textbox', { name: 'What this suite checks' }), {
    target: { value: 'New description' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: 'Target URL' }), {
    target: { value: 'http://changed.invalid' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save revision' }));
  expect(await screen.findByRole('heading', { name: 'Renamed checkout', level: 1 })).toBeVisible();
  await screen.findByText('Saved as revision 5.');
  const posts = fixture.records.filter((request) => request.method !== 'GET');
  expect(posts).toHaveLength(1);
  expect(posts[0]?.method).toBe('POST');
  expect(posts[0]?.body).toMatchObject({
    expectedVersion: 1,
    metadata: { name: 'Renamed checkout', folderId: ids.folder, description: 'New description' },
    config: { target: 'http://changed.invalid' },
  });
  expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Renamed checkout');
});

it('keeps both header values when a duplicate name is refused and Done returns without writing', async () => {
  const config = parseDraft(starter());
  const request = (config.requests as Record<string, unknown>[])[0]!;
  request.headers = { authorization: 'Bearer {{secret.api_token}}', 'content-type': 'application/json' };
  const fixture = testClient(reader(config));
  mount(fixture.client, path);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit request 1' }));
  expect(await screen.findByRole('heading', { name: 'Request: GET /' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Save revision' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox', { name: 'Headers 2 name' }), { target: { value: 'AUTHORIZATION' } });
  expect(screen.getByRole('alert')).toHaveTextContent('both values are kept');
  expect(screen.getByRole('textbox', { name: 'Headers 2 name' })).toHaveValue('content-type');
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  openJson();
  expect((draft().requests as Record<string, unknown>[])[0]?.headers).toEqual(request.headers);
  expect(fixture.records.filter((item) => item.method !== 'GET')).toHaveLength(0);
});

it('keeps optional checks and request edits when returning from the full-page editor', async () => {
  const config = parseDraft(starter());
  (config.requests as Record<string, unknown>[])[0]!.assertions = [
    { id: 'status', kind: 'statusEq', required: true, value: 200 },
  ];
  const fixture = testClient(reader(config));
  mount(fixture.client, path);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit request 1' }));
  fireEvent.change(await screen.findByRole('textbox', { name: 'Path' }), { target: { value: '/new-path' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Check 1 counts' }), { target: { value: 'optional' } });
  fireEvent.click(screen.getByRole('button', { name: 'Back to requests' }));
  expect(await screen.findByRole('textbox', { name: 'Request 1 Path' })).toHaveValue('/new-path');
  openJson();
  expect((draft().requests as Record<string, unknown>[])[0]?.assertions).toEqual([
    { id: 'status', kind: 'statusEq', required: false, value: 200 },
  ]);
  expect(fixture.records.filter((item) => item.method !== 'GET')).toHaveLength(0);
});
