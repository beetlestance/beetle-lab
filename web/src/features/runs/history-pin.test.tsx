// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, act } from '@testing-library/react';
import { routes } from '../../app/routes.js';
import { historyPage, ids, json, testClient, mount, run, scope, deferred, apiError } from './test-fixtures.js';
import { suiteNames } from './history-fixtures.js';

afterEach(cleanup);
const finished = { ...run(), state: 'finished' as const, outcome: 'passed' as const, validationStatus: 'passed' as const };
const path = routes.runs(ids.a, ids.workspace);

it('waits for a pin receipt, refreshes history and permits a later unpin without per-row reads', async () => {
  const held = deferred<Response>();
  let pinned = false;
  const api = testClient(request => {
    if (request.path.endsWith('/unpin')) { pinned = false; return json({ id: finished.id, scope, requestId: request.body!.requestId, pinned: false }); }
    if (request.path.endsWith('/pin')) return held.promise;
    return suiteNames(request.path) ?? json(historyPage([{ ...finished, pinned, ...(pinned ? { pinnedAt: '2026-11-19T00:00:00Z' } : {}) }]));
  });
  mount(api.client, path);
  const pin = await screen.findByRole('button', { name: 'Pin run 1111' });
  fireEvent.click(pin);
  expect(pin).toHaveAttribute('aria-pressed', 'false');
  expect(pin).toHaveAttribute('aria-busy', 'true');
  fireEvent.click(pin);
  await waitFor(() => expect(api.records.filter(r => r.method === 'POST')).toHaveLength(1));
  pinned = true;
  await act(async () => held.resolve(json({ id: finished.id, scope, requestId: api.records.find(r => r.method === 'POST')!.body!.requestId, pinned: true, pinnedAt: '2026-11-19T00:00:00Z' })));
  const unpin = await screen.findByRole('button', { name: 'Unpin run 1111' });
  expect(unpin).toHaveAttribute('aria-pressed', 'true');
  await waitFor(() => expect(api.records.filter(r => r.path.includes('/runs?'))).toHaveLength(2));
  fireEvent.click(unpin);
  await screen.findByRole('button', { name: 'Pin run 1111' });
  expect(api.records.filter(r => r.method === 'GET').every(r => r.path.includes('/runs?') || r.path.includes('/suites?'))).toBe(true);
});

it('retains an unknown pin intent and permits only identical replay', async () => {
  let writes = 0;
  const api = testClient(request => {
    if (request.method === 'POST') {
      writes++; if (writes === 1) throw Error('Unknown acceptance');
      return json({ id: finished.id, scope, requestId: request.body!.requestId, pinned: true, pinnedAt: '2026-11-19T00:00:00Z' });
    }
    return suiteNames(request.path) ?? json(historyPage([finished]));
  });
  mount(api.client, path);
  fireEvent.click(await screen.findByRole('button', { name: 'Pin run 1111' }));
  await screen.findByText(/The outcome is unknown/);
  expect(screen.getByRole('button', { name: 'Pin run 1111' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByRole('button', { name: 'Unpin run 1111' });
  const posts = api.records.filter(r => r.method === 'POST');
  expect(posts).toHaveLength(2); expect(posts[0]!.body).toEqual(posts[1]!.body);
});

it.each(['pin_limit', 'cleanup_in_progress'] as const)('explains %s without an optimistic pin', async reason => {
  const api = testClient(request => request.method === 'POST' ? json({ ...apiError('conflict'), reason }, 409) : suiteNames(request.path) ?? json(historyPage([finished])));
  mount(api.client, path);
  fireEvent.click(await screen.findByRole('button', { name: 'Pin run 1111' }));
  await screen.findByText(reason === 'pin_limit' ? /256 runs are pinned/ : /being removed/);
  expect(screen.getByRole('button', { name: 'Pin run 1111' })).toHaveAttribute('aria-pressed', 'false');
  if (reason === 'cleanup_in_progress') expect(screen.getByRole('button', { name: 'Pin run 1111' })).toBeDisabled();
  else expect(screen.getByRole('link', { name: 'See pinned runs' })).toHaveAttribute('href', expect.stringContaining('pinned=true'));
});

it('hides unfinished controls, marks restored pins and expands colliding row and checkbox labels', async () => {
  const a = { ...finished, id: 'abcd0000-0000-4000-8000-000000001111', pinned: true, pinnedAt: '2026-11-19T00:00:00Z' };
  const b = { ...finished, id: 'abcd0000-0000-4000-8000-000000002222' };
  const api = testClient(request => suiteNames(request.path) ?? json(historyPage([b, a, run()])));
  mount(api.client, path, { readOnly: true, restoredBackup: null });
  expect(await screen.findByText('Pinned at backup')).toBeVisible();
  expect(screen.getByRole('checkbox', { name: 'Compare run abcd…1111' })).toBeEnabled();
  expect(screen.getByRole('checkbox', { name: 'Compare run abcd…2222' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: /Pin run|Unpin run/ })).toBeNull();
  expect(api.records.every(r => r.method === 'GET')).toBe(true);
});
