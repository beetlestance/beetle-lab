// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { Suite, SuiteRevision } from '@beetle/contracts/api';
import { ids, json, mount, readNamespace, testClient } from '../../app/test-fixtures.js';
import type { RequestRecord } from '../../app/test-fixtures.js';
import { routes } from '../../app/routes.js';
import type { Config } from '../suites/draft.js';
import { parseDraft, starter } from '../suites/draft.js';
const scope = { kind: 'workspace' as const, organizationId: ids.a, workspaceId: ids.workspace };
const suiteId = '11111111-1111-4111-8111-111111111111';
const revisionId = '22222222-2222-4222-8222-222222222222';
const path = routes.suitePage(ids.a, ids.workspace, suiteId, { tab: 'edit', view: 'form' });
afterEach(cleanup);
function fixture(configure?: (config: Config) => void) {
  let suite: Suite = {
    id: suiteId,
    scope,
    version: 1,
    folderId: ids.root,
    name: 'Checkout',
    currentRevisionId: revisionId,
  };
  const config = parseDraft(starter());
  Object.assign((config.requests as Record<string, unknown>[])[0]!, {
    body: { kind: 'json', value: { old: true } },
    assertions: [{ id: 'confirmed', kind: 'jsonEquals', path: '$.status', value: 'confirmed', required: true }],
  });
  configure?.(config);
  let revision: SuiteRevision = {
    id: revisionId,
    suiteId,
    scope,
    ordinal: 1,
    engineId: 'k6',
    configVersion: 1,
    digest: 'a'.repeat(64),
    preflightStatus: 'passed',
    inputManifest: [],
    config,
  };
  const reader = (request: RequestRecord): Response => {
    if (request.method === 'POST') {
      revision = {
        ...revision,
        id: '33333333-3333-4333-8333-333333333333',
        ordinal: revision.ordinal + 1,
        config: request.body!.config as Record<string, unknown>,
      };
      suite = { ...suite, version: suite.version + 1, currentRevisionId: revision.id };
      return json(revision, 201);
    }
    if (request.path.endsWith('/suites/' + suiteId)) return json(suite);
    if (request.path.endsWith('/revisions/' + revision.id)) return json(revision);
    if (request.path.includes('/revisions?')) return json({ scope, suiteId, items: [], nextCursor: null });
    if (request.path.includes('/inputs?') || request.path.includes('/runs?'))
      return json({ scope, items: [], nextCursor: null });
    return readNamespace(request);
  };
  const api = testClient(reader);
  mount(api.client, path);
  return api;
}
const openRequest = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Edit request 1' }));
  return screen.findByRole('textbox', { name: 'Inline JSON body' });
};
const done = () => fireEvent.click(screen.getByRole('button', { name: 'Done' }));
const openJson = () => fireEvent.click(screen.getByRole('radio', { name: 'Complete configuration JSON' }));
const configText = () => screen.getByRole('textbox', { name: 'Complete configuration JSON' }) as HTMLTextAreaElement;
it('keeps invalid body text across Done, JSON and a return to the request; saves only the later valid value', async () => {
  const api = fixture();
  const body = await openRequest();
  fireEvent.change(body, { target: { value: '{"new":' } });
  done();
  expect(screen.getByRole('button', { name: 'Save revision' })).toBeDisabled();
  openJson();
  expect(JSON.parse(configText().value).requests[0].body.value).toEqual({ old: true });
  fireEvent.click(screen.getByRole('radio', { name: 'Form editor' }));
  expect(await openRequest()).toHaveValue('{"new":');
  fireEvent.change(screen.getByRole('textbox', { name: 'Inline JSON body' }), { target: { value: '{"new":true}' } });
  done();
  fireEvent.click(screen.getByRole('button', { name: 'Save revision' }));
  await screen.findByText('Saved as revision 2.');
  expect(api.records.filter((request) => request.method === 'POST')).toHaveLength(1);
  expect(api.records.find((request) => request.method === 'POST')?.body?.config).toMatchObject({
    requests: [{ body: { kind: 'json', value: { new: true } } }],
  });
});
it('rejects trailing object members as standalone JSON and explicitly discards retained raw edits', async () => {
  const api = fixture();
  const body = await openRequest();
  fireEvent.change(body, { target: { value: '0,"ignored":true' } });
  done();
  expect(screen.getByRole('button', { name: 'Save revision' })).toBeDisabled();
  expect(api.records.filter((request) => request.method === 'POST')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
  expect(screen.getByRole('button', { name: 'Save revision' })).toBeDisabled();
  expect(JSON.parse(((await openRequest()) as HTMLTextAreaElement).value)).toEqual({ old: true });
  expect(
    screen.queryByText('Enter valid JSON. Your unfinished text is kept and cannot be saved.'),
  ).not.toBeInTheDocument();
});
it('preserves scalar JSON types and retains malformed scalar text until fixed', async () => {
  const api = fixture();
  await openRequest();
  const value = screen.getByRole('textbox', { name: 'Check 1 value' });
  expect(value).toHaveValue('"confirmed"');
  fireEvent.change(value, { target: { value: 'true' } });
  done();
  openJson();
  expect(JSON.parse(configText().value).requests[0].assertions[0].value).toBe(true);
  fireEvent.click(screen.getByRole('radio', { name: 'Form editor' }));
  await openRequest();
  fireEvent.change(screen.getByRole('textbox', { name: 'Check 1 value' }), { target: { value: '"unfinished' } });
  done();
  expect(screen.getByRole('button', { name: 'Save revision' })).toBeDisabled();
  await openRequest();
  expect(screen.getByRole('textbox', { name: 'Check 1 value' })).toHaveValue('"unfinished');
  fireEvent.change(screen.getByRole('textbox', { name: 'Check 1 value' }), { target: { value: 'null' } });
  done();
  openJson();
  expect(JSON.parse(configText().value).requests[0].assertions[0].value).toBeNull();
  expect(api.records.filter((request) => request.method === 'POST')).toHaveLength(0);
});
it('jumps from a retained body problem to its restored raw text', async () => {
  fixture();
  fireEvent.change(await openRequest(), { target: { value: '{' } });
  done();
  fireEvent.click(screen.getByRole('button', { name: 'Request 1 JSON body is not valid JSON. Fix it before saving.' }));
  const field = await screen.findByRole('textbox', { name: 'Inline JSON body' });
  await waitFor(() => expect(document.activeElement).toBe(field));
  expect(field).toHaveValue('{');
});
it('keeps a valid field edit that exceeds the whole configuration budget and lets the form recover', async () => {
  const api = fixture((config) => {
    (config.requests as Record<string, unknown>[]).push({
      id: 'payload',
      name: 'Payload',
      method: 'POST',
      path: '/payload',
      query: {},
      headers: {},
      assertions: [],
      body: { kind: 'json', value: 'x'.repeat(900000) },
    });
    (config.selections as { entries: unknown[] }[])[0]!.entries.push({
      requestId: 'payload',
      weight: 1,
      wait: { durationMs: 0, jitterMs: 0 },
    });
  });
  const field = await openRequest();
  const large = JSON.stringify('y'.repeat(160000));
  fireEvent.change(field, { target: { value: large } });
  done();
  expect(screen.getByRole('button', { name: 'Save revision' })).toBeDisabled();
  openJson();
  expect(screen.getByRole('radio', { name: 'Form editor' })).toBeEnabled();
  fireEvent.click(screen.getByRole('radio', { name: 'Form editor' }));
  expect(((await openRequest()) as HTMLTextAreaElement).value.length).toBe(large.length);
  fireEvent.change(screen.getByRole('textbox', { name: 'Inline JSON body' }), { target: { value: '0' } });
  done();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save revision' })).toBeEnabled());
  expect(api.records.filter((request) => request.method === 'POST')).toHaveLength(0);
});
