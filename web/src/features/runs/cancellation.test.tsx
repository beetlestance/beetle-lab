// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { routes } from '../../app/routes.js';
import { deferred, ids, json, mount, run, runId, runRead, testClient } from './test-fixtures.js';

afterEach(() => { cleanup(); vi.useRealTimers(); });
// The live header shows the cancelling sentence; RunCancellation is no longer composed.
const waiting = /Cancellation requested; waiting for the agent to confirm that execution has stopped/;
const path = routes.run(ids.a, ids.workspace, runId);

it('requests intent once and shows waiting without inventing a terminal outcome', async () => {
  let stopping = false;
  const fixture = testClient(request => {
    if (request.path.endsWith('/cancel')) { stopping = true; return json({ ...run(), cancellationRequested: true, version: 2 }, 202); }
    if (request.path.endsWith(`/runs/${runId}`)) return json({ ...run(), cancellationRequested: stopping, version: stopping ? 2 : 1 });
    return runRead(request);
  });
  mount(fixture.client, path);
  await screen.findByRole('button', { name: 'Cancel run' });
  // Live phase: the live header is the only title and the only Cancel control.
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  expect(screen.queryByRole('heading', { name: 'Run detail' })).not.toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Cancel run' })).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel run' }));
  await screen.findByText(waiting);
  expect((await screen.findAllByText('Cancelling'))[0]).toBeVisible();
  expect(screen.queryByText(/passed|failed|Run cancelled/)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Cancel run' })).not.toBeInTheDocument();
  const posts = fixture.records.filter(record => record.method === 'POST');
  expect(posts).toHaveLength(1); expect(posts[0]!.path).toBe(`${path.replace('/organizations/', '/api/v2/organizations/')}/cancel`);
  expect(posts[0]!.body).toMatchObject({ scope: run().scope });
});

it('retains the same request after a lost response and refreshes current detail', async () => {
  let attempts = 0;
  const fixture = testClient(request => {
    if (request.path.endsWith('/cancel')) {
      if (++attempts === 1) throw new Error('synthetic lost reply after commit');
      return json({ ...run(), version: 2, cancellationRequested: true }, 202);
    }
    return runRead(request);
  });
  mount(fixture.client, path);
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel run' }));
  await screen.findByText(/Cancellation outcome is unknown/);
  expect(screen.getByRole('button', { name: 'Cancel run' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry same cancellation' }));
  await screen.findByText(waiting);
  const posts = fixture.records.filter(record => record.method === 'POST');
  expect(posts).toHaveLength(2); expect(posts[1]!.body).toEqual(posts[0]!.body);
  expect(fixture.records.filter(record => record.path.endsWith(`/runs/${runId}`)).length).toBeGreaterThan(1);
});

it('retires an outstanding cancellation without allowing its late reply to restore removed queries', async () => {
  const held = deferred<Response>();
  const fixture = testClient(request => request.path.endsWith('/cancel') ? held.promise : runRead(request));
  const view = mount(fixture.client, path);
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel run' }));
  await waitFor(() => expect(fixture.records.some(record => record.method === 'POST')).toBe(true));
  const original = fixture.records.find(record => record.method === 'POST')!;
  view.unmount(); expect(original.signal?.aborted).toBe(true);
  const before = fixture.records.length;
  await act(async () => held.resolve(json({ ...run(), cancellationRequested: true, version: 2 }, 202)));
  expect(fixture.records).toHaveLength(before);
});

it('does not offer cancellation for completed history', async () => {
  const fixture = testClient(request => request.path.endsWith(`/runs/${runId}`)
    ? json({ ...run(), state: 'finished', outcome: 'passed', validationStatus: 'passed' }) : runRead(request));
  mount(fixture.client, path); await screen.findByRole('heading', { level: 1, name: /passed$/ });
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Refresh run' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Cancel run' })).not.toBeInTheDocument();
  expect(fixture.records.filter(record => record.method === 'POST')).toHaveLength(0);
});

it('retains unknown cancellation intent across a failed detail read and successful read retry', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  let failReads = false; let posts = 0;
  const fixture = testClient(request => {
    if (request.path.endsWith('/cancel')) {
      if (++posts === 1) throw new Error('synthetic lost reply');
      return json({ ...run(), version: 2, cancellationRequested: true }, 202);
    }
    if (failReads && request.path.endsWith(`/runs/${runId}`)) throw new Error('synthetic read failure');
    return runRead(request);
  });
  mount(fixture.client, path);
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel run' }));
  await screen.findByRole('button', { name: 'Retry same cancellation' });
  // The live phase has no Refresh control; RunDetail's two-second poll re-reads the run.
  failReads = true; await act(() => vi.advanceTimersByTimeAsync(2000));
  await screen.findByRole('button', { name: 'Retry loading' });
  failReads = false; fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Retry same cancellation' }));
  await screen.findByText(waiting);
  const requests = fixture.records.filter(record => record.method === 'POST');
  expect(requests).toHaveLength(2); expect(requests[1]!.body).toEqual(requests[0]!.body);
});
