// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { ApiClient, RunMetricKey } from '@beetle/contracts/api';
import { catalogue, deferred, json, mountComparison, runIds, sampleReply, snapshot, testClient } from './fixtures.js';
afterEach(cleanup);
it('retires an ignored-abort API original on URL replacement and waits for its settlement', async () => {
  const held = deferred<Awaited<ReturnType<ApiClient['compareRuns']>>>();
  let signal: AbortSignal | undefined; let calls = 0;
  const fixture = testClient(request => request.path.endsWith('/comparisons')
    ? json(snapshot(null, request.body?.runIds as string[])) : json({...catalogue(), id: runIds[1]!}));
  const client = {...fixture.client, compareRuns: (input: Parameters<ApiClient['compareRuns']>[0]) => {
    calls++; if (calls === 1) {signal = input.signal; return held.promise;} return fixture.client.compareRuns(input);
  }};
  mountComparison(client); await waitFor(() => expect(calls).toBe(1));
  fireEvent.click(screen.getByRole('button', {name: 'Reverse runs'}));
  expect(signal!.aborted).toBe(true); await act(async () => {await Promise.resolve();}); expect(calls).toBe(1);
  expect(screen.queryByText('Application state / outcome')).not.toBeInTheDocument();
  await act(async () => held.resolve({ok: true, value: snapshot()}));
  await screen.findByLabelText('Baseline metric');
  expect(fixture.records[0]!.body?.runIds).toEqual([...runIds].reverse()); expect(calls).toBe(2);
});
it('session replacement hides evidence and holds the next API behind a retired chart original', async () => {
  const held = deferred<Awaited<ReturnType<ApiClient['getRunMetricSamples']>>>();
  let signal: AbortSignal | undefined; let calls = 0;
  const first = testClient(request => json(request.path.endsWith('/comparisons') ? snapshot(request.body?.metric as RunMetricKey | null) : catalogue()));
  const client = {...first.client, getRunMetricSamples: (input: Parameters<ApiClient['getRunMetricSamples']>[0]) => {calls++; signal = input.signal; return held.promise;}};
  const view = mountComparison(client); await screen.findByLabelText('Baseline metric');
  fireEvent.change(screen.getByLabelText('Baseline metric'), {target: {value: '0'}});
  await waitFor(() => expect(calls).toBe(1));
  const second = testClient(request => json(request.path.endsWith('/comparisons') ? snapshot() : catalogue()));
  view.session(second.client);
  expect(screen.queryByText('Application state / outcome')).not.toBeInTheDocument();
  expect(signal!.aborted).toBe(true); await act(async () => {await Promise.resolve();}); expect(second.records).toHaveLength(0);
  await act(async () => held.resolve({ok: true, value: sampleReply(runIds[0]!, 2)}));
  await screen.findByLabelText('Baseline metric'); expect(second.records).toHaveLength(2);
  expect(screen.queryByRole('img')).not.toBeInTheDocument(); expect(calls).toBe(1);
});
it('unmount aborts the held comparison without starting catalogue work after late success', async () => {
  const held = deferred<Response>(); const fixture = testClient(() => held.promise);
  const view = mountComparison(fixture.client); await waitFor(() => expect(fixture.records).toHaveLength(1));
  view.unmount(); expect(fixture.records[0]!.signal!.aborted).toBe(true);
  await act(async () => held.resolve(json(snapshot()))); expect(fixture.records).toHaveLength(1);
});
it('rejects a same-ordinal sample from a different logical series without drawing it', async () => {
  const fixture = testClient(request => {
    if (request.path.endsWith('/comparisons')) return json(snapshot(request.body?.metric as RunMetricKey | null));
    if (!request.path.includes('/samples?')) return json(catalogue());
    const ordinal = Number(new URL(request.path, 'http://localhost').searchParams.get('seriesOrdinal'));
    const id = runIds.find(value => request.path.includes(value))!; const reply = sampleReply(id, ordinal);
    return json({...reply, series: {...reply.series, metric: 'iterations'}});
  });
  mountComparison(fixture.client); await screen.findByLabelText('Baseline metric');
  fireEvent.change(screen.getByLabelText('Baseline metric'), {target: {value: '0'}});
  await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2));
  expect(screen.queryByRole('img')).not.toBeInTheDocument(); expect(fixture.records).toHaveLength(5);
});

it('retains admission across unmount/remount until an ignored-abort API original settles', async () => {
  const held = deferred<Awaited<ReturnType<ApiClient['compareRuns']>>>(); let calls = 0;
  const first = testClient(() => {throw new Error('Unexpected original transport');});
  const client = {...first.client, compareRuns: () => {calls++; return held.promise;}};
  const view = mountComparison(client); await waitFor(() => expect(calls).toBe(1)); view.unmount();
  const second = testClient(request => json(request.path.endsWith('/comparisons') ? snapshot() : catalogue()));
  mountComparison(second.client); await act(async () => {await Promise.resolve();}); expect(second.records).toHaveLength(0);
  await act(async () => held.resolve({ok: true, value: snapshot()}));
  await screen.findByLabelText('Baseline metric'); expect(second.records).toHaveLength(2);
});
