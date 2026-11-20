// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HistoryReads } from '../live-history/read.js';
import { LiveMetricReads } from '../live-metrics/read.js';
import { liveFrame, liveRun, mountLive, routesFor } from './fixtures.js';

beforeEach(() => {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.spyOn(HistoryReads.prototype, 'read').mockRejectedValue(Error('Synthetic history unavailable'));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it.each(['running', 'reconnecting'])('keeps a disabled cancellation action after a request from %s', async (state) => {
  const current = liveRun({ startedAt: new Date(Date.now() - 316_000).toISOString() });
  let failed = false;
  vi.spyOn(LiveMetricReads.prototype, 'read').mockImplementation(async () => {
    if (failed) throw Error('synthetic read failure');
    return liveFrame(current, 1);
  });
  const cancel = {
    pending: false,
    unknown: false,
    accepted: false,
    message: null,
    request: vi.fn(async () => undefined),
  };
  const view = mountLive(routesFor(() => current).client, { run: current, cancel });
  await screen.findByRole('heading', { name: 'Holding 1,200 a second' });
  if (state === 'reconnecting') {
    failed = true;
    await screen.findByText('Reconnecting', { exact: true }, { timeout: 4000 });
  }
  fireEvent.click(screen.getByRole('button', { name: 'Cancel run' }));
  expect(cancel.request).toHaveBeenCalledTimes(1);
  view.update({ run: current, cancel: { ...cancel, accepted: true } });
  expect(await screen.findByRole('heading', { name: 'Cancelling steady-1.2k' })).toBeVisible();
  expect(screen.getByText(/Last live window at \d\d:\d\d of 10:00/)).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Cancel run' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Cancelling…' })).toBeDisabled();
  expect(screen.queryByText('Reconnecting', { exact: true })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Pause stream' })).not.toBeInTheDocument();
  view.update({ run: { ...current, version: 2, cancellationRequested: true }, cancel: undefined });
  expect(screen.getByRole('button', { name: 'Cancelling…' })).toBeDisabled();
  view.update({ run: { ...current, version: 3, cancellationRequested: true, state: 'finalizing' } });
  expect(screen.queryByRole('button', { name: 'Cancelling…' })).not.toBeInTheDocument();
});
