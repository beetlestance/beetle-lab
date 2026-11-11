// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { captureRunMetricSamplesCursor } from '@beetle/contracts/api';
import { run } from '../test-fixtures.js';
import { apiError, deferred, json, mountMetrics, page, samples, series, testClient } from './fixtures.js';
afterEach(() => {cleanup(); vi.useRealTimers();});
it('composes generated client, ten sequential bounded pages, source gaps and replacement older/latest views', async () => {
  let active = 0; let max = 0; let calls = 0;
  const f = testClient(async request => {
    if (!request.path.includes('/samples?')) return json(page());
    active++; max = Math.max(active, max); calls++; await Promise.resolve();
    const cursor = new URL(request.path, 'http://localhost').searchParams.get('cursor');
    const before = cursor ? captureRunMetricSamplesCursor(cursor).beforeWindow : 2000;
    expect(new URL(request.path, 'http://localhost').searchParams.get('seriesOrdinal')).toBe('0');
    active--; return json(samples(before));
  });
  const view = mountMetrics(f.client);
  expect(await screen.findByText(/View limit reached/)).toBeVisible();
  expect(calls).toBe(10); expect(max).toBe(1); expect(document.querySelectorAll('.metric-dot')).toHaveLength(1000);
  expect(document.querySelectorAll('.metric-line')).toHaveLength(1000);
  expect(view.client.getQueryCache().findAll()).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', {name: 'Older samples'}));
  await waitFor(() => expect(calls).toBe(20)); await waitFor(() => expect(screen.getByRole('button', {name: 'Older samples'})).toBeDisabled());
  expect(document.querySelectorAll('.metric-dot')).toHaveLength(1000);
  expect(screen.queryByText(/View limit reached/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', {name: 'Latest samples'})); await waitFor(() => expect(calls).toBe(30));
});
it('stops at first error, disables overlapping actions and permits a manual latest retry', async () => {
  const hold = deferred<Response>(); let calls = 0;
  const f = testClient(request => !request.path.includes('/samples?') ? json({...page(), windows: 100}) : ++calls === 1 ? hold.promise : json({...samples(100, 100), windows: 100, nextCursor: null}));
  mountMetrics(f.client); await waitFor(() => expect(calls).toBe(1));
  expect(screen.getByRole('button', {name: 'Latest samples'})).toBeDisabled();
  expect(screen.getByRole('button', {name: 'Refresh metrics'})).toBeDisabled();
  await act(async () => hold.resolve(json(apiError('storage_unavailable'), 503)));
  expect(await screen.findByRole('alert')).toHaveTextContent('Source samples could not be loaded'); expect(calls).toBe(1);
  fireEvent.click(screen.getByRole('button', {name: 'Latest samples'})); await screen.findByRole('img'); expect(calls).toBe(2);
});
it('retires late selected-series pages and stops their pagination', async () => {
  const hold = deferred<Response>(); const second = {...series, ordinal: 1, metric: 'iterations'}; let oldCalls = 0;
  const f = testClient(request => {
    if (!request.path.includes('/samples?')) return json({...page(), windows: 100, totalSeries: 2, items: [series, second]});
    const ordinal = new URL(request.path, 'http://localhost').searchParams.get('seriesOrdinal');
    if (ordinal === '0') {oldCalls++; return hold.promise;}
    return json({...samples(100, 100, second), windows: 100, nextCursor: null});
  });
  mountMetrics(f.client); await waitFor(() => expect(oldCalls).toBe(1));
  fireEvent.change(screen.getByRole('combobox'), {target: {value: '1'}});
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(f.records.filter(r => r.path.includes('/samples?'))).toHaveLength(1);
  await act(async () => hold.resolve(json(samples()))); expect(oldCalls).toBe(1);
  await screen.findByRole('img');
  expect(screen.getByRole('img')).toHaveAccessibleName(/iterations/);
});
it('cleans catalogue cache and aborts the original read on unmount', async () => {
  const hold = deferred<Response>(); const f = testClient(() => hold.promise); const view = mountMetrics(f.client);
  await waitFor(() => expect(f.records).toHaveLength(1)); view.unmount(); expect(f.records[0]!.signal?.aborted).toBe(true);
  await act(async () => hold.resolve(json(page()))); expect(view.client.getQueryCache().findAll()).toHaveLength(0);
});
it('retains an exposed API original through StrictMode cleanup/setup and publishes only the current action', async () => {
  const hold = deferred<Awaited<ReturnType<ReturnType<typeof testClient>['client']['getRunMetricSamples']>>>();
  const f = testClient(() => json({...page(), windows: 100})); let calls = 0;
  const api = {...f.client, getRunMetricSamples: vi.fn(async () => {
    if (++calls === 1) return hold.promise;
    return {ok: true as const, value: {...samples(100, 100), windows: 100, nextCursor: null}};
  })};
  mountMetrics(api, false, true); await waitFor(() => expect(calls).toBe(1));
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  await act(async () => hold.resolve({ok: true, value: samples()}));
  await screen.findByRole('img'); expect(calls).toBe(2);
});
it('retains a held exposed sample original across attempt replacement before admitting the new catalogue', async () => {
  const hold = deferred<Awaited<ReturnType<ReturnType<typeof testClient>['client']['getRunMetricSamples']>>>();
  const nextAttempt = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const f = testClient(request => json({...page(), windows: 100, attemptId: request.path.includes(nextAttempt) ? nextAttempt : run().activeAttemptId}));
  let calls = 0;
  const api = {...f.client, getRunMetricSamples: vi.fn(async (input: Parameters<ReturnType<typeof testClient>['client']['getRunMetricSamples']>[0]) => {
    if (++calls === 1) return hold.promise;
    return {ok: true as const, value: {...samples(100, 100), windows: 100, attemptId: input.params.attemptId, nextCursor: null}};
  })};
  const view = mountMetrics(api); await waitFor(() => expect(calls).toBe(1));
  view.select({...run(), activeAttemptId: nextAttempt});
  expect(f.records).toHaveLength(1); expect(calls).toBe(1); expect(screen.queryByRole('img')).not.toBeInTheDocument();
  await act(async () => hold.resolve({ok: true, value: samples()}));
  await screen.findByRole('img'); expect(calls).toBe(2); expect(f.records).toHaveLength(2);
});
