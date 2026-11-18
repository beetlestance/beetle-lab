// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, screen, waitFor } from '@testing-library/react';
import type { Run } from '@beetle/contracts/api';
import { LiveMetricReads } from './live-metrics/read.js';
import { HistoryReads } from './live-history/read.js';
import { routes } from '../../app/routes.js';
import { ids, json, testClient, mount, run, runId, resultSnapshot } from './test-fixtures.js';
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const path = routes.run(ids.a, ids.workspace, runId);
const liveTitle = {
  queued: /waiting for capacity$/,
  dispatching: /is starting$/,
  active: /is starting$/,
  finalizing: /is finalizing$/,
} as const;
it.each(['queued', 'dispatching', 'active', 'finalizing'] as const)(
  'keeps %s outcome pending without manufacturing metrics or pass',
  async (state) => {
    const fixture = testClient((request) =>
      json(request.path.endsWith('/result') ? resultSnapshot() : { ...run(), state }),
    );
    mount(fixture.client, path);
    expect(await screen.findByRole('heading', { level: 1, name: liveTitle[state] })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Open result' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Progress' })).not.toBeInTheDocument();
    expect(screen.queryByText('passed')).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  },
);
it.each(['finished', 'cancelled', 'errored'] as const)(
  'stops polling on %s and aborts/removes on unmount',
  async (state) => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const terminal: Run = {
      ...run(),
      state,
      outcome: 'inconclusive',
      validationStatus: state === 'finished' ? 'passed' : 'pending',
      reason: state === 'finished' ? null : state === 'cancelled' ? 'cancelled' : 'execution_lost',
      cancellationRequested: state === 'cancelled',
    };
    const fixture = testClient((request) =>
      json(request.path.endsWith('/result') ? resultSnapshot(terminal) : terminal),
    );
    const view = mount(fixture.client, path);
    await screen.findByText(/No engine result was published, so thresholds are unavailable/);
    // Run, result, own summary row, suite and revision: each read once, none polls; no session read.
    const reads = () =>
      fixture.records.filter(
        (record) =>
          !record.path.includes('/events?') &&
          !record.path.includes('/artifacts?') &&
          !record.path.includes('/metrics?'),
      );
    await waitFor(() => expect(reads()).toHaveLength(5));
    await act(() => vi.advanceTimersByTimeAsync(6000));
    expect(reads()).toHaveLength(5);
    expect(fixture.records.some((record) => record.path.endsWith('/auth/session'))).toBe(false);
    view.unmount();
  },
);
it('polls nonterminal detail at two seconds then stops on the actual terminal result', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  let requests = 0;
  const fixture = testClient((request) =>
    request.path.endsWith('/result')
      ? json(resultSnapshot())
      : !request.path.endsWith(`/runs/${runId}`)
        ? json(run())
        : json(
            ++requests === 1
              ? { ...run(), state: 'finalizing' }
              : { ...run(), version: 2, state: 'finished', outcome: 'failed', validationStatus: 'passed' },
          ),
  );
  mount(fixture.client, path);
  await screen.findAllByText('Finalizing');
  await act(() => vi.advanceTimersByTimeAsync(1999));
  expect(requests).toBe(1);
  await act(() => vi.advanceTimersByTimeAsync(1));
  await waitFor(() => expect(screen.getByText('Run finished')).toBeVisible());
  expect(screen.getByRole('button', { name: 'Open result' })).toBeVisible();
  await act(() => vi.advanceTimersByTimeAsync(6000));
  expect(requests).toBe(2);
});
it('rejects inferred passed outcome for finalizing through generated bindings', async () => {
  const fixture = testClient(() => json({ ...run(), state: 'finalizing', outcome: 'passed' }));
  mount(fixture.client, path);
  await screen.findByRole('alert');
  expect(screen.queryByText('passed')).not.toBeInTheDocument();
});

it.each(['queued', 'dispatching', 'active', 'finalizing'] as const)(
  'freezes restored %s records without current-work reads or polling',
  async (state) => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const live = vi
      .spyOn(LiveMetricReads.prototype, 'read')
      .mockRejectedValue(Error('Current metrics forbidden in restored history'));
    const history = vi
      .spyOn(HistoryReads.prototype, 'read')
      .mockRejectedValue(Error('Current history forbidden in restored history'));
    const current: Run = { ...run(), state };
    const fixture = testClient((request) => json(request.path.endsWith('/result') ? resultSnapshot(current) : current));
    mount(fixture.client, path, {
      readOnly: true,
      restoredBackup: { backupId: ids.request, createdAt: '2026-11-12T02:00:00.000Z' },
    });
    expect(await screen.findByRole('heading', { name: new RegExp(`was ${state} at backup$`) })).toBeVisible();
    expect(
      screen.getByText('This unfinished run is recorded history. Restoring a backup does not resume it.'),
    ).toBeVisible();
    await screen.findByText('Target-runtime report is unavailable.');
    const runReads = () => fixture.records.filter((record) => record.path.endsWith('/runs/' + runId));
    expect(runReads()).toHaveLength(1);
    await act(() => vi.advanceTimersByTimeAsync(6000));
    expect(runReads()).toHaveLength(1);
    expect(live).not.toHaveBeenCalled();
    expect(history).not.toHaveBeenCalled();
    expect(
      fixture.records.some((record) =>
        /\/(queue|installation\/status|metrics\/live|metrics\/live-history)(?:\?|$)/.test(record.path),
      ),
    ).toBe(false);
    expect(fixture.records.every((record) => record.method === 'GET')).toBe(true);
    expect(screen.queryByRole('button', { name: /Cancel run|Run again|Pause stream|Retry engine version/ })).toBeNull();
  },
);
