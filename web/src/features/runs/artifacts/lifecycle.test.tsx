// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { focusManager } from '@tanstack/react-query';
import type { Run } from '@beetle/contracts/api';
import { queryKeys } from '../../../app/queries.js';
import { apiError, artifactId, cursor, deferred, ids, json, mountArtifacts, page, run, testClient } from './fixtures.js';
afterEach(() => { cleanup(); vi.useRealTimers(); focusManager.setFocused(undefined); });

it('polls pending every two visible seconds, then stops on published readiness', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }); let reads = 0;
  const fixture = testClient(() => json(++reads < 3 ? page(run(), 'pending') : page()));
  mountArtifacts(fixture.client); await screen.findByText('Artifact publication is pending.');
  await act(() => vi.advanceTimersByTimeAsync(1999)); expect(reads).toBe(1);
  await act(() => vi.advanceTimersByTimeAsync(1)); await waitFor(() => expect(reads).toBe(2));
  act(() => focusManager.setFocused(false));
  await act(() => vi.advanceTimersByTimeAsync(6000)); expect(reads).toBe(2);
  act(() => focusManager.setFocused(true));
  await act(() => vi.advanceTimersByTimeAsync(2000));
  expect(await screen.findByText('reports/file-0.bin')).toBeVisible(); expect(reads).toBe(3);
  await act(() => vi.advanceTimersByTimeAsync(6000)); expect(reads).toBe(3);
});
it('stops absent polling without inferring readiness from terminal state', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  const fixture = testClient(() => json(page(run(), 'absent')));
  const view = mountArtifacts(fixture.client); await screen.findByText(/No artifact source was published/);
  view.select(run(), true);
  await act(() => vi.advanceTimersByTimeAsync(6000)); expect(fixture.records).toHaveLength(1);
});
it.each(['pending', 'ready', 'error'] as const)('waits for terminal-transition original %s before considering one refresh', async status => {
  const held = deferred<Response>(); let reads = 0;
  const fixture = testClient(() => ++reads === 1 ? held.promise : json(page()));
  const view = mountArtifacts(fixture.client);
  await waitFor(() => expect(reads).toBe(1));
  view.select({ ...run(), state: 'finished' }, true);
  expect(reads).toBe(1); expect(fixture.records[0]!.signal?.aborted).toBe(false);
  await act(async () => held.resolve(status === 'error' ? json(apiError('storage_unavailable'), 503) : json(page(run(), status))));
  if (status === 'error') await screen.findByRole('alert');
  else await screen.findByText('reports/file-0.bin');
  expect(reads).toBe(status === 'pending' ? 2 : 1);
});
const switches = {
  organization: (current: Run): Run => ({ ...current, scope: { ...current.scope, organizationId: ids.b } }),
  workspace: (current: Run): Run => ({ ...current, scope: { ...current.scope, workspaceId: ids.b } }),
  run: (current: Run): Run => ({ ...current, id: ids.b }),
  attempt: (current: Run): Run => ({ ...current, activeAttemptId: ids.b }),
};
it.each(Object.keys(switches) as (keyof typeof switches)[])('retires ready %s links and supports selected historical attempts at the boundary', async boundary => {
  let current = run(); const held = deferred<Response>(); let reads = 0;
  const fixture = testClient(() => ++reads === 1 ? json(page(current)) : held.promise);
  const view = mountArtifacts(fixture.client); await screen.findByRole('link');
  current = switches[boundary](current); view.select(current);
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  await waitFor(() => expect(reads).toBe(2));
  await act(async () => held.resolve(json(page(current))));
  const link = await screen.findByRole('link');
  expect(link).toHaveAttribute('href', expect.stringContaining(`/attempts/${current.activeAttemptId}/`));
  expect(view.client.getQueryCache().findAll()).toHaveLength(1);
});
it.each(Object.keys(switches).flatMap(boundary => ['success', 'error'].map(reply => [boundary, reply] as const)))(
  'aborts and fences late %s page %s', async (boundary, reply) => {
    const old = run(); const current = switches[boundary as keyof typeof switches](old);
    const late = deferred<Response>(); const fresh = deferred<Response>(); let reads = 0;
    const fixture = testClient(() => ++reads === 1 ? late.promise : fresh.promise);
    const view = mountArtifacts(fixture.client);
    await waitFor(() => expect(reads).toBe(1)); view.select(current);
    await waitFor(() => expect(reads).toBe(2)); expect(fixture.records[0]!.signal?.aborted).toBe(true);
    await act(async () => late.resolve(reply === 'success' ? json(page(old)) : json(apiError('storage_unavailable'), 503)));
    expect(screen.getByRole('status')).toHaveTextContent('Loading artifact inventory');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument(); expect(screen.queryByRole('link')).not.toBeInTheDocument();
    await act(async () => fresh.resolve(json(page(current)))); await screen.findByRole('link');
    expect(view.client.getQueryCache().findAll()).toHaveLength(1);
  });
it('removes a held next-page original on session unmount; a late response cannot restore cache or links', async () => {
  const late = deferred<Response>(); let reads = 0;
  const fixture = testClient(() => ++reads === 1 ? json({ ...page(), items: Array.from({ length: 100 }, (_, index) => ({
    ...page().items[0]!, artifactId: `44444444-4444-4444-8444-${String(index).padStart(12, '0')}` })), nextCursor: cursor() }) : late.promise);
  const view = mountArtifacts(fixture.client); await screen.findByRole('button', { name: 'Next artifact page' });
  fireEvent.click(screen.getByRole('button', { name: 'Next artifact page' })); await waitFor(() => expect(reads).toBe(2));
  view.unmount(); expect(fixture.records[1]!.signal?.aborted).toBe(true);
  await act(async () => late.resolve(json(page())));
  expect(view.client.getQueryCache().findAll()).toHaveLength(0); expect(view.client.isFetching()).toBe(0);
  const fresh = testClient(() => json(page({ ...run(), activeAttemptId: artifactId })));
  mountArtifacts(fresh.client, { ...run(), activeAttemptId: artifactId });
  expect(await screen.findByRole('link')).toHaveAttribute('href', expect.stringContaining(`/attempts/${artifactId}/`));
});
it('uses the reserved scoped query key and retains no content bytes', async () => {
  const fixture = testClient(() => json(page())); const view = mountArtifacts(fixture.client); await screen.findByRole('link');
  const current = run();
  expect(view.client.getQueryCache().findAll().map(query => query.queryKey)).toEqual([
    queryKeys.runArtifacts(ids.a, ids.workspace, current.id, current.activeAttemptId),
  ]);
  expect(view.client.getQueryData(queryKeys.runArtifacts(ids.a, ids.workspace, current.id, current.activeAttemptId))).toEqual(page());
});
