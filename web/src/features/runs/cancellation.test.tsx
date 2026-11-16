// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { routes } from '../../app/routes.js';
import { deferred, ids, json, mount, run, runId, runRead, testClient } from './test-fixtures.js';

afterEach(cleanup);
const path = routes.run(ids.a, ids.workspace, runId);

it('requests intent once and shows waiting without inventing a terminal outcome', async () => {
  let stopping = false;
  const fixture = testClient(request => {
    if (request.path.endsWith('/cancel')) { stopping = true; return json({ ...run(), cancellationRequested: true, version: 2 }, 202); }
    if (request.path.endsWith(`/runs/${runId}`)) return json({ ...run(), cancellationRequested: stopping, version: stopping ? 2 : 1 });
    return runRead(request);
  });
  mount(fixture.client, path);
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel run' }));
  await screen.findByText(/Cancellation requested. Waiting/);
  expect(screen.getAllByText('pending')).toHaveLength(2);
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
  await screen.findByText(/Cancellation requested. Waiting/);
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
  mount(fixture.client, path); await screen.findByText('finished');
  expect(screen.queryByRole('button', { name: 'Cancel run' })).not.toBeInTheDocument();
  expect(fixture.records.filter(record => record.method === 'POST')).toHaveLength(0);
});

it('retains unknown cancellation intent across a failed detail read and successful read retry', async () => {
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
  failReads = true; fireEvent.click(screen.getByRole('button', { name: 'Refresh run' }));
  await screen.findByRole('button', { name: 'Retry loading' });
  failReads = false; fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Retry same cancellation' }));
  await screen.findByText(/Cancellation requested. Waiting/);
  const requests = fixture.records.filter(record => record.method === 'POST');
  expect(requests).toHaveLength(2); expect(requests[1]!.body).toEqual(requests[0]!.body);
});
