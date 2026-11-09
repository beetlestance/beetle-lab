// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, screen, waitFor } from '@testing-library/react';
import type { Run } from '@beetle/contracts/api';
import { routes } from '../../app/routes.js';
import { ids, json, testClient, mount, run, runId } from './test-fixtures.js';
afterEach(() => { cleanup(); vi.useRealTimers(); });
const path = routes.run(ids.a, ids.workspace, runId);
it.each(['queued', 'dispatching', 'active', 'finalizing'] as const)('keeps %s outcome pending without manufacturing metrics or pass', async state => {
  const fixture = testClient(() => json({ ...run(), state })); mount(fixture.client, path);
  await screen.findByText(state);
  expect(screen.getAllByText('pending')).toHaveLength(2);
  expect(screen.getByText(/Metrics and result artifacts are unavailable/)).toBeVisible();
  expect(screen.queryByText('passed')).not.toBeInTheDocument();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
});
it.each(['finished', 'cancelled', 'errored'] as const)('stops polling on %s and aborts/removes on unmount', async state => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  const terminal: Run = { ...run(), state, outcome: 'inconclusive', validationStatus: state === 'finished' ? 'passed' : 'pending',
    reason: state === 'finished' ? null : state === 'cancelled' ? 'cancelled' : 'execution_lost', cancellationRequested: state === 'cancelled' };
  const fixture = testClient(() => json(terminal)); const view = mount(fixture.client, path);
  await screen.findAllByText(state); expect(fixture.records).toHaveLength(1);
  await act(() => vi.advanceTimersByTimeAsync(6000));
  expect(fixture.records).toHaveLength(1); view.unmount();
});
it('polls nonterminal detail at two seconds then stops on the actual terminal result', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  let requests = 0;
  const fixture = testClient(() => json(++requests === 1 ? { ...run(), state: 'finalizing' }
    : { ...run(), version: 2, state: 'finished', outcome: 'failed', validationStatus: 'passed' }));
  mount(fixture.client, path); await screen.findByText('finalizing');
  await act(() => vi.advanceTimersByTimeAsync(1999)); expect(requests).toBe(1);
  await act(() => vi.advanceTimersByTimeAsync(1));
  await waitFor(() => expect(screen.getByText('finished')).toBeVisible());
  await act(() => vi.advanceTimersByTimeAsync(6000)); expect(requests).toBe(2);
});
it('rejects inferred passed outcome for finalizing through generated bindings', async () => {
  const fixture = testClient(() => json({ ...run(), state: 'finalizing', outcome: 'passed' }));
  mount(fixture.client, path); await screen.findByRole('alert'); expect(screen.queryByText('passed')).not.toBeInTheDocument();
});
