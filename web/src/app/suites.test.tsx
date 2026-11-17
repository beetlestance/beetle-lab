// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { Suite, SuiteRevision } from '@beetle/contracts/api';
import { ids, json, mount, readNamespace, testClient, apiError, deferred } from './test-fixtures.js';
import { routes } from './routes.js';
import { draftText, parseDraft, starter, updatePart } from '../features/suites/draft.js';

afterEach(cleanup);
const scope = { kind: 'workspace' as const, organizationId: ids.a, workspaceId: ids.workspace };
const suiteId = '11111111-1111-4111-8111-111111111111';
const revisionId = '22222222-2222-4222-8222-222222222222';
// The editor lives on the suite's Edit tab (package B owns the tabs).
const path = `${routes.suite(ids.a, ids.workspace, suiteId)}?tab=edit`;
function suite(version = 1): Suite {
  return { id: suiteId, scope, name: 'Checkout', version, folderId: ids.root, currentRevisionId: null };
}
function revision(): SuiteRevision {
  return { id: revisionId, scope, suiteId, ordinal: 1, engineId: 'k6', configVersion: 1,
    digest: 'a'.repeat(64), config: parseDraft(starter()), inputManifest: [], preflightStatus: 'passed' };
}
function read(request: Parameters<typeof readNamespace>[0]) {
  if (request.path.endsWith(`/suites/${suiteId}`)) return json(suite());
  if (request.path.includes(`/suites/${suiteId}/revisions?`)) return json({ scope, suiteId, items: [], nextCursor: null });
  if (request.path.includes('/suites?')) return json({ scope, items: [suite()], nextCursor: null });
  return readNamespace(request);
}
async function openJson() {
  fireEvent.click(await screen.findByRole('radio', { name: 'Complete configuration JSON' }));
  return screen.getByRole('textbox', { name: 'Complete configuration JSON' });
}
const saveButton = () => screen.getByRole('button', { name: 'Save revision' });
describe('suite draft boundaries', () => {
  it('preserves advanced nested fields through target edits and JSON round trips', () => {
    const advanced = { ...parseDraft(starter()), secrets: [{ id: 'token', source: { kind: 'env', name: 'SYNTHETIC_REF' } }],
      datasets: [{ id: 'rows', input: { id: ids.folder, hash: 'abc', bytes: 7 } }], custom: { nested: [false, null, '東京'] } };
    const result = parseDraft(updatePart(draftText(advanced), 'target', 'http://synthetic.invalid'));
    expect(result).toEqual({ ...advanced, target: 'http://synthetic.invalid' });
  });
  it('rejects invalid JSON, nonobjects, oversized UTF-8 and excessive depth', () => {
    expect(() => parseDraft('{')).toThrow('valid JSON');
    expect(() => parseDraft('[]')).toThrow('object');
    expect(() => parseDraft(`{"target":"${'é'.repeat(524288)}"}`)).toThrow('1 MiB');
    expect(() => parseDraft(`{"x":${'['.repeat(65)}'x'${']'.repeat(65)}}`)).toThrow();
    expect(() => draftText({ x: 'x'.repeat(1048576) })).toThrow();
  });
});
it('creates a k6 suite in the actual scoped root through the engine picker and opens its Edit tab', async () => {
  const fixture = testClient(request => request.method === 'POST' ? json(suite(), 201) : read(request));
  mount(fixture.client, routes.suites(ids.a, ids.workspace));
  fireEvent.click(await screen.findByRole('button', { name: 'New suite' }));
  expect(screen.getByRole('dialog', { name: 'What should this suite run?' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Choose k6 load tests' }));
  const name = await screen.findByRole('textbox', { name: 'Suite name' });
  await waitFor(() => expect(document.activeElement).toBe(name));
  fireEvent.change(name, { target: { value: 'Checkout' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create suite' }));
  await screen.findByText('Suite version 1');
  const body = fixture.records.find(record => record.method === 'POST')?.body;
  expect(body).toMatchObject({ name: 'Checkout', folderId: ids.root, scope });
  expect(body).not.toHaveProperty('description');
  expect(screen.getByRole('tab', { name: 'Edit' })).toHaveAttribute('aria-selected', 'true');
});
it('keeps invalid JSON editable and blocks form conversion and saving it', async () => {
  const fixture = testClient(read); mount(fixture.client, path);
  const editor = await openJson(); fireEvent.change(editor, { target: { value: '{broken' } });
  fireEvent.click(saveButton());
  expect(screen.getByRole('radio', { name: 'Form editor' })).toBeDisabled();
  expect(saveButton()).toBeDisabled();
  expect(editor).toHaveValue('{broken');
  expect(fixture.records.filter(record => record.method === 'POST')).toHaveLength(0);
});
it('names form problems with jump-to and sends nothing until they are fixed', async () => {
  const fixture = testClient(read); mount(fixture.client, path);
  const field = await screen.findByRole('textbox', { name: 'Request 1 Path' });
  fireEvent.change(field, { target: { value: 'no-slash' } });
  fireEvent.click(saveButton());
  await screen.findByText('Fix 1 thing before saving');
  fireEvent.click(screen.getByRole('button', { name: 'Request 1 path must start with /.' }));
  await waitFor(() => expect(document.activeElement).toBe(field));
  expect(fixture.records.filter(record => record.method === 'POST')).toHaveLength(0);
  fireEvent.change(field, { target: { value: '/fixed' } });
  expect(screen.queryByText('Fix 1 thing before saving')).not.toBeInTheDocument();
});
it('freezes an unknown write and replays identical request/version/config', async () => {
  let posts = 0;
  const fixture = testClient(request => {
    if (request.method === 'POST') { if (++posts === 1) throw new Error('lost synthetic reply'); return json(revision(), 201); }
    return read(request);
  });
  mount(fixture.client, path); const editor = await openJson();
  const config = { ...parseDraft(starter()), secrets: [{ id: 'opaque', version: 'v1' }] };
  fireEvent.change(editor, { target: { value: draftText(config) } });
  fireEvent.click(saveButton());
  fireEvent.click(await screen.findByRole('button', { name: 'Retry identical request' }));
  await screen.findByText('Saved as revision 1.');
  const writes = fixture.records.filter(record => record.method === 'POST');
  expect(writes).toHaveLength(2); expect(writes[1]?.body).toEqual(writes[0]?.body);
  expect(writes[0]?.body).toMatchObject({ config, expectedVersion: 1, engineId: 'k6', configVersion: 1 });
});
it('names the conflicting revision and saves the kept draft on top of it', async () => {
  const otherId = '44444444-4444-4444-8444-444444444444';
  let posts = 0;
  const fixture = testClient(request => {
    if (request.method === 'POST') return ++posts === 1 ? json(apiError('conflict'), 409) : json({ ...revision(), ordinal: 3 }, 201);
    if (request.path.endsWith(`/suites/${suiteId}`)) return json({ ...suite(posts ? 2 : 1), currentRevisionId: posts ? otherId : null });
    if (request.path.endsWith(`/revisions/${otherId}`))
      return json({ ...revision(), id: otherId, ordinal: 2, savedAt: '2026-11-14T11:40:00Z', savedBy: 'Meera' });
    return read(request);
  });
  mount(fixture.client, path); const editor = await openJson();
  const text = updatePart(starter(), 'target', 'http://preserved.invalid');
  fireEvent.change(editor, { target: { value: text } });
  fireEvent.click(saveButton());
  const dialog = await screen.findByRole('dialog', { name: /^Revision 2 was saved on Nov 14, .* by Meera$/ });
  expect(dialog).toHaveTextContent('Your edits are still here');
  expect(screen.getByRole('link', { name: 'Open revision 2' })).toHaveAttribute('href', routes.suiteScript(ids.a, ids.workspace, suiteId, otherId));
  fireEvent.click(screen.getByRole('button', { name: 'Save as revision 3' }));
  await screen.findByText('Saved as revision 3.');
  const writes = fixture.records.filter(record => record.method === 'POST');
  expect(writes).toHaveLength(2);
  expect(writes[1]?.body).toMatchObject({ expectedVersion: 2, config: writes[0]?.body?.config });
  expect(writes[1]?.body?.requestId).not.toBe(writes[0]?.body?.requestId);
  expect(editor).toHaveValue(text);
});
it('aborts retired scope reads and ignores late replies', async () => {
  const late = deferred<Response>();
  const fixture = testClient(request => request.path.endsWith(`/suites/${suiteId}`) ? late.promise : read(request));
  mount(fixture.client, path);
  await waitFor(() => expect(fixture.records.some(record => record.path.endsWith(`/suites/${suiteId}`))).toBe(true));
  const pending = fixture.records.find(record => record.path.endsWith(`/suites/${suiteId}`));
  fireEvent.click(screen.getByRole('button', { name: 'Switch workspace B' }));
  await screen.findByRole('heading', { name: 'Folders' });
  expect(pending?.signal?.aborted).toBe(true);
  late.resolve(json(suite())); await Promise.resolve(); expect(screen.queryByRole('heading', { name: 'Checkout' })).not.toBeInTheDocument();
});

it('appends history and reads an older immutable revision without writing a pointer', async () => {
  const older = revision();
  const newerId = '33333333-3333-4333-8333-333333333333';
  const newer = { ...older, id: newerId, ordinal: 2, config: { ...older.config, target: 'http://new.invalid' } };
  const summaries = [older, newer].map(item => ({ id: item.id, scope: item.scope, suiteId: item.suiteId, ordinal: item.ordinal, engineId: item.engineId, configVersion: item.configVersion, digest: item.digest, preflightStatus: item.preflightStatus }));
  const fixture = testClient(request => {
    if (request.path.endsWith(`/suites/${suiteId}`)) return json({ ...suite(3), currentRevisionId: newerId });
    if (request.path.includes(`/suites/${suiteId}/revisions?`)) return json({ scope, suiteId, items: summaries, nextCursor: null });
    if (request.path.endsWith(`/revisions/${newerId}`)) return json(newer);
    if (request.path.endsWith(`/revisions/${revisionId}`)) return json(older);
    return read(request);
  });
  mount(fixture.client, `${routes.suite(ids.a, ids.workspace, suiteId)}?tab=revisions`);
  expect(await screen.findByRole('tab', { name: 'Revisions (2)' })).toHaveAttribute('aria-selected', 'true');
  fireEvent.click(await screen.findByRole('button', { name: 'Changes from revision 1' }));
  const changes = await screen.findByRole('list', { name: 'Changes in revision 2' });
  expect(changes).toHaveTextContent('target: http://target.invalid to http://new.invalid');
  expect(screen.getAllByRole('link', { name: 'View script' })[0]).toHaveAttribute('href', routes.suiteScript(ids.a, ids.workspace, suiteId, newerId));
  expect(fixture.records.every(record => record.method === 'GET')).toBe(true);
  fireEvent.click(screen.getByRole('tab', { name: 'Edit' }));
  fireEvent.click(await screen.findByRole('radio', { name: 'Complete configuration JSON' }));
  expect(JSON.parse((screen.getByRole('textbox', { name: 'Complete configuration JSON' }) as HTMLTextAreaElement).value)).toEqual(newer.config);
});
it('rejects wrong-scope suite replies through the generated client', async () => {
  const fixture = testClient(request => request.path.endsWith(`/suites/${suiteId}`)
    ? json({ ...suite(), scope: { ...scope, organizationId: ids.b } }) : read(request));
  mount(fixture.client, path);
  await screen.findByText('The service returned an unreadable response.');
  expect(screen.queryByRole('heading', { name: 'Checkout' })).not.toBeInTheDocument();
});
it('round-trips advanced JSON through form controls without removing nested fields', async () => {
  const fixture = testClient(read); mount(fixture.client, path);
  const editor = await openJson();
  const original = { ...parseDraft(starter()), advanced: { nested: ['東京', null, false] }, datasets: [{ input: { id: ids.folder, version: 2 } }] };
  fireEvent.change(editor, { target: { value: draftText(original) } });
  fireEvent.click(screen.getByRole('radio', { name: 'Form editor' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Target URL' }), { target: { value: 'http://edited.invalid' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Request 1 Path' }), { target: { value: '/edited' } });
  fireEvent.click(screen.getByRole('radio', { name: 'Complete configuration JSON' }));
  const complete = screen.getByRole('textbox', { name: 'Complete configuration JSON' });
  await waitFor(() => expect(document.activeElement).toBe(complete));
  const actual = parseDraft((complete as HTMLTextAreaElement).value);
  expect(actual.advanced).toEqual(original.advanced); expect(actual.datasets).toEqual(original.datasets);
  expect(actual.target).toBe('http://edited.invalid');
  expect(actual.requests).toEqual([{ ...(parseDraft(starter()).requests as Record<string, unknown>[])[0], path: '/edited' }]);
});
it('preserves oversized UTF-8 text and rejects it before transport', async () => {
  const fixture = testClient(read); mount(fixture.client, path);
  const editor = await openJson(); const text = `{"target":"${'é'.repeat(524288)}"}`;
  fireEvent.change(editor, { target: { value: text } });
  fireEvent.click(saveButton());
  expect(editor).toHaveValue(text);
  expect(fixture.records.filter(record => record.method === 'POST')).toHaveLength(0);
});
it('aborts a pending write on scope retirement and retires its draft', async () => {
  const late = deferred<Response>();
  const fixture = testClient(request => request.method === 'POST' ? late.promise : read(request));
  mount(fixture.client, path); await openJson();
  fireEvent.click(saveButton());
  await waitFor(() => expect(fixture.records.some(record => record.method === 'POST')).toBe(true));
  const write = fixture.records.find(record => record.method === 'POST');
  fireEvent.click(screen.getByRole('button', { name: 'Switch workspace B' }));
  await screen.findByRole('heading', { name: 'Folders' });
  expect(write?.signal?.aborted).toBe(true); late.resolve(json(revision(), 201));
  expect(screen.queryByRole('textbox', { name: 'Complete configuration JSON' })).not.toBeInTheDocument();
});

it('refuses a form edit that would overflow the complete config and blocks save', async () => {
  const fixture = testClient(read); mount(fixture.client, path);
  const editor = await openJson();
  const config: Record<string, unknown> = { ...parseDraft(starter()), padding: 'x'.repeat(1047800) };
  fireEvent.change(editor, { target: { value: draftText(config) } });
  fireEvent.click(screen.getByRole('radio', { name: 'Form editor' }));
  const requestPath = screen.getByRole('textbox', { name: 'Request 1 Path' });
  fireEvent.change(requestPath, { target: { value: '/' + 'p'.repeat(2000) } });
  await screen.findByText(/would push the configuration past 1 MiB/);
  expect(requestPath).toHaveValue('/');
  expect(saveButton()).toBeDisabled();
  fireEvent.click(saveButton());
  expect(fixture.records.filter(record => record.method === 'POST')).toHaveLength(0);
});

it('preserves a draft through a failed conflict read and recovery', async () => {
  let failRead = false;
  const fixture = testClient(request => {
    if (request.method === 'POST') { failRead = true; return json(apiError('conflict'), 409); }
    if (request.path.endsWith(`/suites/${suiteId}`)) return failRead ? json(apiError('storage_unavailable'), 503) : json(suite(2));
    return read(request);
  });
  mount(fixture.client, path); const editor = await openJson();
  const draft = updatePart(starter(), 'target', 'http://kept-through-refresh.invalid');
  fireEvent.change(editor, { target: { value: draft } });
  fireEvent.click(saveButton());
  await screen.findByText('Could not read the latest revision. Your draft is kept.');
  expect(screen.getByRole('button', { name: 'Save on top' })).toBeDisabled();
  failRead = false; fireEvent.click(screen.getByRole('button', { name: 'Retry reading' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save on top' })).not.toBeDisabled());
  fireEvent.click(screen.getByRole('button', { name: 'Copy my edits' }));
  expect(screen.getByRole('textbox', { name: 'Complete configuration JSON' })).toHaveValue(draft);
});

it('preserves an acknowledged draft when refresh fails without claiming refreshed data', async () => {
  let failRead = false;
  const fixture = testClient(request => {
    if (request.method === 'POST') { failRead = true; return json({ ...revision(), config: request.body!.config }, 201); }
    if (request.path.endsWith(`/suites/${suiteId}`)) return failRead ? json(apiError('storage_unavailable'), 503) : json(suite());
    return read(request);
  });
  mount(fixture.client, path); const editor = await openJson();
  const draft = updatePart(starter(), 'target', 'http://acknowledged.invalid');
  fireEvent.change(editor, { target: { value: draft } });
  fireEvent.click(saveButton());
  await screen.findByText(/Storage unavailable/);
  expect(screen.getByRole('textbox', { name: 'Complete configuration JSON' })).toHaveValue(draft);
  expect(screen.getByText('Saved as revision 1.')).toBeInTheDocument();
  expect(screen.queryByText(/history are refreshed/)).not.toBeInTheDocument();
});
