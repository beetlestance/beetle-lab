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
const path = routes.suite(ids.a, ids.workspace, suiteId);
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
  fireEvent.click(await screen.findByRole('button', { name: 'JSON editor' }));
  return screen.getByRole('textbox', { name: 'Complete configuration JSON' });
}
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
it('creates with the actual scoped root and supports paged folder selection without submitting', async () => {
  const fixture = testClient(request => request.method === 'POST' ? json(suite(), 201) : read(request));
  mount(fixture.client, routes.suites(ids.a, ids.workspace));
  fireEvent.click(await screen.findByRole('button', { name: 'Create suite' }));
  const name = screen.getByRole('textbox', { name: 'Suite name' });
  await waitFor(() => expect(document.activeElement).toBe(name));
  fireEvent.change(name, { target: { value: 'Checkout' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save suite' }));
  await screen.findByText(/Saved. The current version/);
  const body = fixture.records.find(record => record.method === 'POST')?.body;
  expect(body).toMatchObject({ name: 'Checkout', folderId: ids.root, scope });
});
it('keeps invalid JSON editable and blocks form conversion and saving it', async () => {
  const fixture = testClient(read); mount(fixture.client, path);
  const editor = await openJson(); fireEvent.change(editor, { target: { value: '{broken' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save new revision' }));
  expect(screen.getByRole('button', { name: 'Form editor' })).toBeDisabled();
  expect(editor).toHaveValue('{broken');
  expect(fixture.records.filter(record => record.method === 'POST')).toHaveLength(0);
});
it('retains invalid request text and blocks leaving the form or saving until corrected', async () => {
  const fixture = testClient(read); mount(fixture.client, path);
  const requests = await screen.findByRole('textbox', { name: 'Requests JSON' });
  fireEvent.change(requests, { target: { value: '[' } });
  expect(screen.getByRole('button', { name: 'JSON editor' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Save new revision' })).toBeDisabled();
  expect(requests).toHaveValue('[');
  fireEvent.change(requests, { target: { value: '[]' } });
  expect(screen.getByRole('button', { name: 'JSON editor' })).not.toBeDisabled();
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
  fireEvent.click(screen.getByRole('button', { name: 'Save new revision' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Retry identical request' }));
  await screen.findByText(/Saved. The current version/);
  const writes = fixture.records.filter(record => record.method === 'POST');
  expect(writes).toHaveLength(2); expect(writes[1]?.body).toEqual(writes[0]?.body);
  expect(writes[0]?.body).toMatchObject({ config, expectedVersion: 1, engineId: 'k6', configVersion: 1 });
});
it('reloads a conflict version without replacing the draft', async () => {
  let version = 1;
  const fixture = testClient(request => {
    if (request.method === 'POST') { version = 2; return json(apiError('conflict'), 409); }
    if (request.path.endsWith(`/suites/${suiteId}`)) return json(suite(version));
    return read(request);
  });
  mount(fixture.client, path); const editor = await openJson();
  const text = updatePart(starter(), 'target', 'http://preserved.invalid');
  fireEvent.change(editor, { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Save new revision' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Reload current version' }));
  await screen.findByText('Suite version 2'); expect(editor).toHaveValue(text);
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
  mount(fixture.client, path);
  fireEvent.click(await screen.findByRole('button', { name: 'View revision 1' }));
  const saved = await screen.findByRole('textbox', { name: 'Saved configuration JSON' });
  expect(JSON.parse((saved as HTMLTextAreaElement).value)).toEqual(older.config);
  expect(fixture.records.every(record => record.method === 'GET')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'JSON editor' }));
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
  fireEvent.click(screen.getByRole('button', { name: 'Form editor' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Target URL' }), { target: { value: 'http://edited.invalid' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Request 1 path' }), { target: { value: '/edited' } });
  fireEvent.click(screen.getByRole('button', { name: 'JSON editor' }));
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
  fireEvent.click(screen.getByRole('button', { name: 'Save new revision' }));
  expect(editor).toHaveValue(text);
  expect(fixture.records.filter(record => record.method === 'POST')).toHaveLength(0);
});
it('aborts a pending write on scope retirement and retires its draft', async () => {
  const late = deferred<Response>();
  const fixture = testClient(request => request.method === 'POST' ? late.promise : read(request));
  mount(fixture.client, path); await openJson();
  fireEvent.click(screen.getByRole('button', { name: 'Save new revision' }));
  await waitFor(() => expect(fixture.records.some(record => record.method === 'POST')).toBe(true));
  const write = fixture.records.find(record => record.method === 'POST');
  fireEvent.click(screen.getByRole('button', { name: 'Switch workspace B' }));
  await screen.findByRole('heading', { name: 'Folders' });
  expect(write?.signal?.aborted).toBe(true); late.resolve(json(revision(), 201));
  expect(screen.queryByRole('textbox', { name: 'Complete configuration JSON' })).not.toBeInTheDocument();
});

it('retains invalid Requests JSON while editing request controls', async () => {
  const fixture = testClient(read); mount(fixture.client, path);
  const requests = await screen.findByRole('textbox', { name: 'Requests JSON' });
  fireEvent.change(requests, { target: { value: '[{"unfinished":' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Request 1 path' }), { target: { value: '/changed' } });
  expect(requests).toHaveValue('[{"unfinished":');
});

it('blocks save when a JSON part overflows the complete config', async () => {
  const fixture = testClient(read); mount(fixture.client, path);
  const editor = await openJson();
  const config = { ...parseDraft(starter()), padding: 'x'.repeat(1047800) };
  fireEvent.change(editor, { target: { value: draftText(config) } });
  fireEvent.click(screen.getByRole('button', { name: 'Form editor' }));
  const requests = screen.getByRole('textbox', { name: 'Requests JSON' });
  const changed = [{ ...(config.requests as object[])[0], path: '/' + 'p'.repeat(2000) }];
  fireEvent.change(requests, { target: { value: JSON.stringify(changed) } });
  expect(requests).toHaveValue(JSON.stringify(changed));
  expect(screen.getByRole('button', { name: 'Save new revision' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Save new revision' }));
  expect(fixture.records.filter(record => record.method === 'POST')).toHaveLength(0);
});
