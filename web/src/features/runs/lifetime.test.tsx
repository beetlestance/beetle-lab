// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { ApiClient } from '@beetle/contracts/api';
import { ApiContext } from '../../app/api.js';
import { createQueryClient, queryKeys } from '../../app/queries.js';
import { routes } from '../../app/routes.js';
import { Runs } from './index.js';
import { captureRequest, initialValues } from './request.js';
import { useSubmission } from './useSubmission.js';
import { ids, json, testClient, run, runId, runRead, deferred, receipt, revision, settings } from './test-fixtures.js';

afterEach(cleanup);
function environment(api: ApiClient) {
  const client = createQueryClient();
  function Frame({ children }: { children: ReactNode }) {
    return <MemoryRouter><ApiContext.Provider value={api}><QueryClientProvider client={client}>
      {children}
    </QueryClientProvider></ApiContext.Provider></MemoryRouter>;
  }
  return { client, Frame };
}
it('discards the actual retired scope cache while retaining the new scoped history', async () => {
  const fixture = testClient(runRead); const { client, Frame } = environment(fixture.client);
  const view = render(<Frame><Runs organizationId={ids.a} workspaceId={ids.workspace} /></Frame>);
  await screen.findByRole('link', { name: runId });
  const old = queryKeys.runs(ids.a, ids.workspace); const current = queryKeys.runs(ids.b, ids.workspace);
  expect(client.getQueryCache().findAll({ queryKey: old })).toHaveLength(1);
  view.rerender(<Frame><Runs organizationId={ids.b} workspaceId={ids.workspace} /></Frame>);
  await waitFor(() => expect(screen.getByRole('link', { name: runId }))
    .toHaveAttribute('href', routes.run(ids.b, ids.workspace, runId)));
  expect(client.getQueryCache().findAll({ queryKey: old })).toHaveLength(0);
  expect(client.getQueryCache().findAll({ queryKey: current })).toHaveLength(1);
  view.unmount(); expect(client.getQueryCache().findAll({ queryKey: current })).toHaveLength(0);
});
it('aborts an unresolved detail original and cannot repopulate its removed cache after unmount', async () => {
  const late = deferred<Response>(); const fixture = testClient(() => late.promise);
  const { client, Frame } = environment(fixture.client);
  const view = render(<Frame><Runs organizationId={ids.a} workspaceId={ids.workspace} runId={runId} /></Frame>);
  await waitFor(() => expect(fixture.records).toHaveLength(1));
  const key = queryKeys.run(ids.a, ids.workspace, runId);
  expect(client.getQueryCache().findAll({ queryKey: key })).toHaveLength(1);
  view.unmount(); expect(fixture.records[0]?.signal?.aborted).toBe(true);
  await act(async () => late.resolve(json(run())));
  expect(client.getQueryCache().findAll({ queryKey: key })).toHaveLength(0);
  expect(client.isFetching()).toBe(0);
});
it('guards two submissions in the same event before React can disable a button', async () => {
  const late = deferred<Response>(); const fixture = testClient(() => late.promise);
  const { Frame } = environment(fixture.client);
  const body = captureRequest({ revision: revision(), settings: settings(), values: initialValues(settings()), requestId: ids.request });
  function DoubleIssue() {
    const submit = useSubmission();
    return <button onClick={() => { void submit.send(body); void submit.send(body); }}>Issue twice</button>;
  }
  render(<Frame><DoubleIssue /></Frame>);
  fireEvent.click(screen.getByRole('button', { name: 'Issue twice' }));
  await waitFor(() => expect(fixture.records.filter(record => record.method === 'POST')).toHaveLength(1));
  await act(async () => late.resolve(json(receipt(body), 202)));
  expect(fixture.records.filter(record => record.method === 'POST')).toHaveLength(1);
});
