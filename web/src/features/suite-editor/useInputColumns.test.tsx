// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ApiContext } from '../../app/api.js';
import { createQueryClient } from '../../app/queries.js';
import { apiError, deferred, ids, json, testClient } from '../../app/test-fixtures.js';
import { useInputColumns } from './useInputColumns.js';
import type { RequestRecord } from '../../app/test-fixtures.js';
const scope = { kind: 'workspace' as const, organizationId: ids.a, workspaceId: ids.workspace };
const first = '11111111-1111-4111-8111-111111111111';
const second = '22222222-2222-4222-8222-222222222222';
const input = (id: string) => ({ id, sha256: 'a'.repeat(64), bytes: 12 });
const config = {
  datasets: [
    { id: 'users', kind: 'csv', selection: 'byVu', input: input(first) },
    { id: 'other', kind: 'json', selection: 'random', input: input(second) },
  ],
};
function reply(request: RequestRecord, changes = {}) {
  const url = new URL(request.path, 'http://synthetic.invalid');
  return json({
    scope: { ...scope, organizationId: request.path.includes(ids.b) ? ids.b : ids.a },
    inputId: request.path.includes(first) ? first : second,
    sha256: 'a'.repeat(64),
    bytes: 12,
    kind: url.searchParams.get('kind'),
    columns: ['id'],
    ...changes,
  });
}
function mount(handler: (request: RequestRecord) => Response | Promise<Response>, value = config) {
  const api = testClient(handler);
  const client = createQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ApiContext.Provider value={api.client}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </ApiContext.Provider>
  );
  const view = renderHook(({ owner }) => useInputColumns(owner, value), { wrapper, initialProps: { owner: scope } });
  return { ...view, api };
}
afterEach(cleanup);
it('deduplicates identical references and discovers different inputs sequentially', async () => {
  const held = deferred<Response>();
  const value = { datasets: [...config.datasets, { ...config.datasets[0]!, id: 'users_copy' }] };
  const view = mount((request) => (request.path.includes(first) ? held.promise : reply(request)), value);
  await waitFor(() => expect(view.api.records).toHaveLength(1));
  expect(view.result.current.pending).toBe(true);
  expect(view.result.current.columns.size).toBe(0);
  await act(async () => held.resolve(reply(view.api.records[0]!)));
  await waitFor(() => expect(view.result.current.pending).toBe(false));
  expect(view.api.records).toHaveLength(2);
  expect(view.result.current.columns.get('users')).toEqual(['id']);
  expect(view.result.current.columns.get('users_copy')).toEqual(['id']);
  expect(view.result.current.columns.get('other')).toEqual(['id']);
});
it('does not retry overload automatically and retries only failed discoveries when requested', async () => {
  let attempts = 0;
  const view = mount((request) =>
    request.path.includes(first) && ++attempts === 1
      ? json({ ...apiError('capacity_unavailable'), message: 'Capacity unavailable', retryable: true }, 503)
      : reply(request),
  );
  await waitFor(() => expect(view.result.current.pending).toBe(false));
  expect(view.result.current.failed).toBe(true);
  expect(view.api.records).toHaveLength(2);
  act(() => view.result.current.retry());
  await waitFor(() => expect(view.result.current.failed).toBe(false));
  expect(view.api.records).toHaveLength(3);
  expect(view.result.current.columns.get('users')).toEqual(['id']);
});
it('refuses names for another content identity, route owner or parser kind', async () => {
  for (const changes of [
    { sha256: 'b'.repeat(64) },
    { inputId: second },
    { scope: { ...scope, organizationId: ids.b } },
    { kind: 'json' },
  ]) {
    const view = mount((request) => reply(request, changes), { datasets: [config.datasets[0]!] });
    await waitFor(() => expect(view.result.current.pending).toBe(false));
    expect(view.result.current.failed).toBe(true);
    expect(view.result.current.columns.size).toBe(0);
    view.unmount();
  }
});
it('aborts the current request on retirement and never starts the next after a late reply', async () => {
  const held = deferred<Response>();
  const view = mount(() => held.promise);
  await waitFor(() => expect(view.api.records).toHaveLength(1));
  const request = view.api.records[0]!;
  view.unmount();
  expect(request.signal?.aborted).toBe(true);
  await act(async () => held.resolve(reply(request)));
  expect(view.api.records).toHaveLength(1);
});
it('isolates a new scope from the old scope’s late result', async () => {
  const held = deferred<Response>();
  const view = mount((request) => (request.path.includes(ids.a) ? held.promise : reply(request)));
  await waitFor(() => expect(view.api.records).toHaveLength(1));
  const previous = view.api.records[0]!;
  view.rerender({ owner: { ...scope, organizationId: ids.b } });
  await waitFor(() => expect(view.result.current.pending).toBe(false));
  expect(previous.signal?.aborted).toBe(true);
  expect(view.result.current.failed).toBe(false);
  await act(async () => held.resolve(reply(previous, { columns: ['old_scope_column'] })));
  expect(view.result.current.columns.get('users')).toEqual(['id']);
});
it('clears retry progress when the owner changes during a pending manual retry', async () => {
  const held = deferred<Response>();
  let attempts = 0;
  const view = mount(
    (request) => {
      if (!request.path.includes(ids.a)) return reply(request);
      if (++attempts === 1)
        return json({ ...apiError('capacity_unavailable'), message: 'Capacity unavailable', retryable: true }, 503);
      return held.promise;
    },
    { datasets: [config.datasets[0]!] },
  );
  await waitFor(() => expect(view.result.current.pending).toBe(false));
  expect(view.result.current.failed).toBe(true);
  act(() => view.result.current.retry());
  await waitFor(() => expect(view.api.records).toHaveLength(2));
  const retry = view.api.records[1]!;
  view.rerender({ owner: { ...scope, organizationId: ids.b } });
  await waitFor(() => expect(view.result.current.pending).toBe(false));
  expect(retry.signal?.aborted).toBe(true);
  expect(view.result.current.failed).toBe(false);
  await act(async () => held.resolve(reply(retry, { columns: ['old_owner'] })));
  expect(view.result.current.columns.get('users')).toEqual(['id']);
  expect(view.result.current.pending).toBe(false);
});
