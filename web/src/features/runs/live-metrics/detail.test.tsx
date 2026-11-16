// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Run } from '@beetle/contracts/api';
import { routes } from '../../../app/routes.js';
import { ids, json, testClient, mount, run, runId, resultSnapshot } from '../test-fixtures.js';
import { LiveMetricReads } from './read.js';
import { deferred, value } from './ui-fixtures.js';
afterEach(() => {cleanup(); vi.restoreAllMocks();});
it('switches from active live reads to recorded history and fences the old reply when execution finalizes', async () => {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  let current: Run = {...run(), state: 'active'}; const original = current;
  const gate = deferred<ReturnType<typeof value>>(); const read = vi.spyOn(LiveMetricReads.prototype, 'read').mockImplementation(() => gate.promise);
  const fixture = testClient(request => json(request.path.endsWith('/result') ? resultSnapshot(current) : current));
  mount(fixture.client, routes.run(ids.a, ids.workspace, runId));
  await screen.findByRole('heading', {name: 'Live metrics'}); await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
  current = {...current, version: 2, state: 'finalizing'};
  fireEvent.click(screen.getByRole('button', {name: 'Refresh run'}));
  await screen.findByRole('heading', {name: 'Recorded metrics'});
  expect(read.mock.calls[0]![0].signal.aborted).toBe(true);
  await act(async () => {gate.resolve(value(original));});
  expect(screen.queryByRole('heading', {name: 'Live metrics'})).not.toBeInTheDocument();
  expect(screen.queryByRole('cell', {name: '42 count'})).not.toBeInTheDocument();
});
