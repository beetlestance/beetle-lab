// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, screen, waitFor } from '@testing-library/react';
import type { Run } from '@beetle/contracts/api';
import { routes } from '../../app/routes.js';
import { ids, json, testClient, mount, run, runId, resultSnapshot } from './test-fixtures.js';
afterEach(() => { cleanup(); vi.useRealTimers(); });
const path = routes.run(ids.a, ids.workspace, runId);
const liveLabel = { queued: 'Queued', dispatching: 'Starting', active: 'Starting', finalizing: 'Finalizing' } as const;
it.each(['queued', 'dispatching', 'active', 'finalizing'] as const)('keeps %s outcome pending without manufacturing metrics or pass', async state => {
  const fixture = testClient(request => json(request.path.endsWith('/result') ? resultSnapshot() : { ...run(), state })); mount(fixture.client, path);
  expect((await screen.findAllByText(liveLabel[state]))[0]).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Open result' })).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Progress' })).not.toBeInTheDocument();
  expect(screen.queryByText('passed')).not.toBeInTheDocument();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
});
it.each(['finished', 'cancelled', 'errored'] as const)('stops polling on %s and aborts/removes on unmount', async state => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  const terminal: Run = { ...run(), state, outcome: 'inconclusive', validationStatus: state === 'finished' ? 'passed' : 'pending',
    reason: state === 'finished' ? null : state === 'cancelled' ? 'cancelled' : 'execution_lost', cancellationRequested: state === 'cancelled' };
  const fixture = testClient(request => json(request.path.endsWith('/result') ? resultSnapshot(terminal) : terminal)); const view = mount(fixture.client, path);
  await screen.findAllByText(state); await screen.findByText(/Metrics and result artifacts are unavailable/);
  expect(fixture.records.filter(record => !record.path.includes('/events?') && !record.path.includes('/artifacts?') && !record.path.includes('/metrics?'))).toHaveLength(2);
  await act(() => vi.advanceTimersByTimeAsync(6000));
  expect(fixture.records.filter(record => !record.path.includes('/events?') && !record.path.includes('/artifacts?') && !record.path.includes('/metrics?'))).toHaveLength(2); view.unmount();
});
it('polls nonterminal detail at two seconds then stops on the actual terminal result', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  let requests = 0;
  const fixture = testClient(request => request.path.endsWith('/result') ? json(resultSnapshot()) : !request.path.endsWith(`/runs/${runId}`) ? json(run())
    : json(++requests === 1 ? { ...run(), state: 'finalizing' } : { ...run(), version: 2, state: 'finished', outcome: 'failed', validationStatus: 'passed' }));
  mount(fixture.client, path); await screen.findAllByText('Finalizing');
  await act(() => vi.advanceTimersByTimeAsync(1999)); expect(requests).toBe(1);
  await act(() => vi.advanceTimersByTimeAsync(1));
  await waitFor(() => expect(screen.getByText('Run finished')).toBeVisible());
  expect(screen.getByRole('button', { name: 'Open result' })).toBeVisible();
  await act(() => vi.advanceTimersByTimeAsync(6000)); expect(requests).toBe(2);
});
it('rejects inferred passed outcome for finalizing through generated bindings', async () => {
  const fixture = testClient(() => json({ ...run(), state: 'finalizing', outcome: 'passed' }));
  mount(fixture.client, path); await screen.findByRole('alert'); expect(screen.queryByText('passed')).not.toBeInTheDocument();
});
