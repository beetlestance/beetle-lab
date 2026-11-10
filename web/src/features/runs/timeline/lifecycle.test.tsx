// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { focusManager } from '@tanstack/react-query';
import { queryKeys } from '../../../app/queries.js';
import { mountActivity, deferred, ids, json, page, requested, run, testClient } from './fixtures.js';
import type { Timeline } from './projection.js';
afterEach(() => { cleanup(); focusManager.setFocused(true); vi.useRealTimers(); });
it('polls at two seconds, pauses hidden, stops on error, retains rows and explicitly retries', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  let fail = false;
  const fixture = testClient(request => fail ? new Response('', { status: 503 }) : json(page({ ...requested(request.path), through: 1 })));
  const view = mountActivity(fixture.client);
  await screen.findByText('Runtime started'); expect(fixture.records).toHaveLength(1);
  await act(() => vi.advanceTimersByTimeAsync(1999)); expect(fixture.records).toHaveLength(1);
  await act(() => vi.advanceTimersByTimeAsync(1)); await waitFor(() => expect(fixture.records).toHaveLength(2));
  focusManager.setFocused(false); await act(() => vi.advanceTimersByTimeAsync(6000)); expect(fixture.records).toHaveLength(2);
  focusManager.setFocused(true); fail = true;
  await act(() => vi.advanceTimersByTimeAsync(2000)); await screen.findByRole('alert');
  expect(screen.getByText('Runtime started')).toBeVisible(); const count = fixture.records.length;
  await act(() => vi.advanceTimersByTimeAsync(6000)); expect(fixture.records).toHaveLength(count);
  fail = false; fireEvent.click(screen.getByRole('button', { name: 'Refresh activity' }));
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  const cached = view.client.getQueryData<Timeline>(queryKeys.runEvents(ids.a, ids.workspace, run().id, ids.request));
  expect(cached?.rows).toHaveLength(1); expect(view.client.getQueryCache().getAll()).toHaveLength(1);
});
it('waits a held original on terminal transition, final refreshes once, drains on bounded intervals', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  const held = deferred<Response>(); let reads = 0;
  const fixture = testClient(request => ++reads === 1 ? held.promise : json(page({ ...requested(request.path), through: 202 })));
  const view = mountActivity(fixture.client); await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); await waitFor(() => expect(reads).toBe(1));
  view.select(run(), true); expect(reads).toBe(1);
  await act(async () => held.resolve(json(page({ through: 1 }))));
  await waitFor(() => expect(reads).toBe(2));
  expect(screen.getByText(/More durable activity remains/)).toBeVisible();
  await act(() => vi.advanceTimersByTimeAsync(1999)); expect(reads).toBe(2);
  await act(() => vi.advanceTimersByTimeAsync(1)); await waitFor(() => expect(reads).toBe(3));
  await act(() => vi.advanceTimersByTimeAsync(2000)); await waitFor(() => expect(reads).toBe(4));
  await act(() => vi.advanceTimersByTimeAsync(6000)); expect(reads).toBe(4);
  const data = view.client.getQueryCache().getAll()[0]?.state.data as Timeline;
  expect(data.rows).toHaveLength(100); expect(data.omitted).toBe(true);
});
const switches = {
  organization: () => ({ ...run(), scope: { ...run().scope, organizationId: ids.b } }),
  workspace: () => ({ ...run(), scope: { ...run().scope, workspaceId: ids.b } }),
  run: () => ({ ...run(), id: ids.b }),
  attempt: () => ({ ...run(), activeAttemptId: ids.b }),
};
it.each((Object.keys(switches) as (keyof typeof switches)[]).flatMap(boundary => [1, 2].map(heldCall => ({ boundary, heldCall }))))('retires held call $heldCall on $boundary replacement and removes exact old cache', async ({ boundary, heldCall }) => {
  const old = run(); const fresh = switches[boundary](); const held = deferred<Response>();
  let current = old; let calls = 0;
  const fixture = testClient(request => ++calls === heldCall ? held.promise : json(page({ ...requested(request.path), current, through: calls < heldCall ? 200 : 0 })));
  const view = mountActivity(fixture.client); await waitFor(() => expect(calls).toBe(heldCall));
  current = fresh; view.select(fresh);
  await screen.findByText(/Event capture pending/);
  expect(fixture.records[heldCall - 1]?.signal?.aborted).toBe(true);
  await act(async () => held.resolve(json(page({ after: heldCall === 1 ? 0 : 100, through: 200, limit: heldCall === 1 ? 1 : 100 }))));
  expect(calls).toBe(heldCall + 1); expect(view.client.getQueryData(queryKeys.runEvents(old.scope.organizationId, old.scope.workspaceId, old.id, old.activeAttemptId))).toBeUndefined();
  expect(screen.queryByText('Runtime started')).not.toBeInTheDocument();
});
it.each([1, 2])('unmount after held call %s aborts and cannot repopulate cache or issue continuation', async heldCall => {
  const held = deferred<Response>(); let calls = 0;
  const fixture = testClient(request => ++calls === heldCall ? held.promise : json(page({ ...requested(request.path), through: 200 })));
  const view = mountActivity(fixture.client); await waitFor(() => expect(calls).toBe(heldCall));
  view.unmount(); expect(fixture.records.at(-1)?.signal?.aborted).toBe(true);
  await act(async () => held.resolve(json(page({ after: heldCall === 1 ? 0 : 100, through: 200, limit: heldCall === 1 ? 1 : 100 }))));
  expect(calls).toBe(heldCall); expect(view.client.getQueryCache().getAll()).toHaveLength(0);
});
it.each([1, 2])('retires held session call %s before it can continue bootstrap', async heldCall => {
  const held = deferred<Response>(); let calls = 0;
  const old = testClient(request => ++calls === heldCall ? held.promise : json(page({ ...requested(request.path), through: 200 })));
  const fresh = testClient(() => json(page())); const view = mountActivity(old.client);
  await waitFor(() => expect(old.records).toHaveLength(heldCall));
  view.unmount();
  const next = mountActivity(fresh.client);
  await screen.findByText(/Event capture pending/);
  // Match the authenticated generation remount owned by SessionApp.
  await act(async () => held.resolve(json(page({ after: heldCall === 1 ? 0 : 100, through: 200, limit: heldCall === 1 ? 1 : 100 }))));
  expect(old.records).toHaveLength(heldCall); expect(old.records[heldCall - 1]?.signal?.aborted).toBe(true);
  expect(next.client.getQueryCache().getAll()).toHaveLength(1);
});
it('shows blocked delivery, retained gap, pending/empty and zero resources without a verdict', async () => {
  const gap = { ...page(), coverage: 'partial' as const, blockedReason: 'cursor_expired' as const, retainedStartSeq: 12 };
  const fixture = testClient(() => json(gap)); mountActivity(fixture.client, run(), true);
  await screen.findByText('Delivery blocked: cursor expired.'); expect(screen.getByText(/sequence 12/)).toBeVisible();
  expect(screen.getByText('No activity rows reported.')).toBeVisible(); expect(screen.getAllByText('Not reported')).toHaveLength(2);
});
it('a terminal transition after a held read fails preserves the error until manual retry', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  const held = deferred<Response>(); let calls = 0;
  const fixture = testClient(() => ++calls === 1 ? held.promise : json(page()));
  const view = mountActivity(fixture.client);
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  await waitFor(() => expect(calls).toBe(1)); view.select(run(), true);
  await act(async () => held.resolve(new Response('', { status: 503 })));
  await screen.findByRole('alert');
  await act(() => vi.advanceTimersByTimeAsync(6000)); expect(calls).toBe(1);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh activity' }));
  await screen.findByText(/Event capture pending/); expect(calls).toBe(2);
});
