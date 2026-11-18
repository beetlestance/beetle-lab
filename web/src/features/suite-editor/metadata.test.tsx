// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { Suite, SuiteRevision } from '@beetle/contracts/api';
import { ApiContext } from '../../app/api.js';
import { createQueryClient } from '../../app/queries.js';
import { apiError, deferred, ids, json, testClient } from '../../app/test-fixtures.js';
import { parseDraft, starter } from '../suites/draft.js';
import { metadataPatch, useMetadataDraft } from './metadata.js';
import { useRevisionDraft } from './useRevisionDraft.js';
afterEach(cleanup);
const scope = { kind: 'workspace' as const, organizationId: ids.a, workspaceId: ids.workspace };
const suite: Suite = {
  id: '11111111-1111-4111-8111-111111111111',
  scope,
  version: 1,
  name: 'Original',
  description: 'Before',
  folderId: ids.root,
  currentRevisionId: '22222222-2222-4222-8222-222222222222',
};
const config = parseDraft(starter());
const initial: SuiteRevision = {
  id: suite.currentRevisionId!,
  suiteId: suite.id,
  scope,
  ordinal: 1,
  engineId: 'k6',
  configVersion: 1,
  digest: 'a'.repeat(64),
  preflightStatus: 'passed',
  config,
  inputManifest: [],
};
it('sends only normalized changes and uses null to clear descriptions', () => {
  const before = { name: 'Original', folderId: ids.root, description: 'Before' };
  expect(metadataPatch(before, { ...before, name: ' Original ' })).toBeUndefined();
  expect(metadataPatch(before, { ...before, name: ' New ', description: '  ' })).toEqual({
    name: 'New',
    description: null,
  });
});
it('refreshes untouched fields while preserving an edited field, and validates bounded metadata', async () => {
  const view = renderHook(({ value }) => useMetadataDraft(value), { initialProps: { value: suite } });
  act(() => view.result.current.change({ ...view.result.current.value, name: 'My draft' }));
  view.rerender({ value: { ...suite, version: 2, name: 'Remote', description: 'Remote description' } });
  await waitFor(() =>
    expect(view.result.current.value).toMatchObject({ name: 'My draft', description: 'Remote description' }),
  );
  expect(view.result.current.patch).toEqual({ name: 'My draft' });
  act(() => view.result.current.change({ ...view.result.current.value, name: ' '.repeat(3) }));
  expect(view.result.current.problems[0]?.path).toBe('/metadata/name');
  act(() => view.result.current.discard());
  expect(view.result.current.value.name).toBe('Remote');
});
it('keeps the draft version frozen when a newer suite arrives and exposes version conflicts', async () => {
  const api = testClient((request) =>
    request.method === 'POST' ? json(apiError('conflict'), 409) : json({ scope, items: [], nextCursor: null }),
  );
  const client = createQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ApiContext.Provider value={api.client}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </ApiContext.Provider>
  );
  const view = renderHook(({ value }) => useRevisionDraft(value, initial, async () => undefined, 1), {
    initialProps: { value: suite },
    wrapper,
  });
  view.rerender({ value: { ...suite, version: 7, name: 'Remote' } });
  act(() => view.result.current.setMessage('Keep my change'));
  act(() => view.result.current.save());
  await waitFor(() => expect(view.result.current.conflict).toBe(true));
  expect(api.records.find((request) => request.method === 'POST')?.body).toMatchObject({
    expectedVersion: 1,
    message: 'Keep my change',
  });
  expect(api.records.find((request) => request.method === 'POST')?.body).not.toHaveProperty('metadata');
});
it('acknowledges metadata receipts without discarding later edits or treating field conflicts as version conflicts', async () => {
  const api = testClient((request) =>
    request.method === 'POST'
      ? json({ ...apiError('conflict'), fields: [{ path: '/metadata/name', code: 'conflict' }] }, 409)
      : json({ scope, items: [], nextCursor: null }),
  );
  const client = createQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ApiContext.Provider value={api.client}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </ApiContext.Provider>
  );
  const view = renderHook(() => useRevisionDraft(suite, initial, async () => undefined), { wrapper });
  act(() => view.result.current.metadata.change({ ...view.result.current.metadata.value, name: 'Occupied' }));
  act(() => view.result.current.save());
  await waitFor(() => expect(view.result.current.write.failure).not.toBeNull());
  expect(view.result.current.conflict).toBe(false);
  expect(view.result.current.problems).toEqual(
    expect.arrayContaining([expect.objectContaining({ path: '/metadata/name' })]),
  );
  expect(api.records.find((request) => request.method === 'POST')?.body).toMatchObject({
    metadata: { name: 'Occupied' },
  });
  act(() => view.result.current.metadata.change({ ...view.result.current.metadata.value, name: 'Later edit' }));
  act(() =>
    view.result.current.metadata.acknowledge(
      { name: 'Occupied', folderId: ids.root, description: 'Before' },
      { name: 'Occupied' },
      1,
    ),
  );
  expect(view.result.current.metadata.value.name).toBe('Later edit');
  expect(view.result.current.metadata.dirty).toBe(true);
});

it('replays the identical compound request after an unknown outcome and preserves newer draft edits', async () => {
  let posts = 0;
  const accepted = { ...initial, id: '33333333-3333-4333-8333-333333333333', ordinal: 2 };
  const api = testClient((request) => {
    if (request.method !== 'POST') return json({ scope, items: [], nextCursor: null });
    if (++posts === 1) throw Error('Synthetic lost response');
    return json(accepted, 201);
  });
  const client = createQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ApiContext.Provider value={api.client}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </ApiContext.Provider>
  );
  const view = renderHook(({ value }) => useRevisionDraft(value, initial, async () => undefined), {
    initialProps: { value: suite },
    wrapper,
  });
  act(() => view.result.current.metadata.change({ ...view.result.current.metadata.value, name: 'Sent name' }));
  act(() => view.result.current.save());
  await waitFor(() => expect(view.result.current.write.unknown).toBe(true));
  act(() => view.result.current.metadata.change({ ...view.result.current.metadata.value, name: 'Newer draft' }));
  act(() => view.result.current.write.replay());
  await waitFor(() => expect(view.result.current.saved).toBe(2));
  const mutations = api.records.filter((request) => request.method === 'POST');
  expect(mutations).toHaveLength(2);
  expect(mutations[1]?.body).toEqual(mutations[0]?.body);
  expect(mutations[1]?.body).toMatchObject({ expectedVersion: 1, metadata: { name: 'Sent name' } });
  view.rerender({ value: { ...suite, name: 'Sent name', version: 2, currentRevisionId: accepted.id } });
  expect(view.result.current.metadata.value.name).toBe('Newer draft');
  expect(view.result.current.metadata.dirty).toBe(true);
});
it('aborts a pending compound save on owner retirement without refreshing after its late reply', async () => {
  const pending = deferred<Response>();
  let refreshed = 0;
  const api = testClient((request) =>
    request.method === 'POST' ? pending.promise : json({ scope, items: [], nextCursor: null }),
  );
  const client = createQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ApiContext.Provider value={api.client}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </ApiContext.Provider>
  );
  const view = renderHook(
    () =>
      useRevisionDraft(suite, initial, async () => {
        refreshed++;
      }),
    { wrapper },
  );
  act(() => view.result.current.metadata.change({ ...view.result.current.metadata.value, name: 'Pending' }));
  act(() => view.result.current.save());
  await waitFor(() => expect(api.records.filter((request) => request.method === 'POST')).toHaveLength(1));
  const mutation = api.records.find((request) => request.method === 'POST');
  expect(mutation?.signal?.aborted).toBe(false);
  view.unmount();
  expect(mutation?.signal?.aborted).toBe(true);
  await act(async () =>
    pending.resolve(json({ ...initial, id: '33333333-3333-4333-8333-333333333333', ordinal: 2 }, 201)),
  );
  expect(refreshed).toBe(0);
});
