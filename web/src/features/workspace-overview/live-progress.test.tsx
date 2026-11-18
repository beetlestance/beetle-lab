// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiContext } from '../../app/api.js';
import { createQueryClient } from '../../app/queries.js';
import { LiveMetricReads } from '../runs/live-metrics/read.js';
import { liveFrame, liveRun, routesFor } from '../runs/live/fixtures.js';
import { LiveProgress } from './LiveProgress.js';

beforeEach(() => vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible'));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function mount() {
  const run = liveRun({ startedAt: new Date(Date.now() - 316_000).toISOString() });
  const api = routesFor(() => run);
  const view = render(<QueryClientProvider client={createQueryClient()}><ApiContext.Provider value={api.client}>
    <LiveProgress run={run} now={Date.now()} />
  </ApiContext.Provider></QueryClientProvider>);
  return {run, ...view};
}
it('shows three real latest-window figures and the saved plan without inventing a pooled p95', async () => {
  const run = liveRun();
  const read = vi.spyOn(LiveMetricReads.prototype, 'read').mockImplementation(async () => liveFrame(run));
  mount();
  const progress = await screen.findByRole('region', { name: 'Progress' });
  expect(await within(progress).findByText('1,200')).toBeVisible();
  expect(within(progress).getByText('236 ms')).toBeVisible();
  expect(within(progress).getByText('p95 latency, slowest endpoint')).toBeVisible();
  expect(within(progress).getByText('0.17%')).toBeVisible();
  expect(within(progress).queryByText(/virtual users busy/)).not.toBeInTheDocument();
  expect(within(progress).getByRole('list', {name:'Load stages'})).toHaveTextContent('Steady at 1,200 a second');
  expect(progress).toHaveTextContent('52%');
  expect(read).toHaveBeenCalledTimes(1);
});
it('keeps failed live reads unknown and allows an explicit fresh read', async () => {
  const run = liveRun();
  const read = vi.spyOn(LiveMetricReads.prototype, 'read').mockRejectedValueOnce(new Error('synthetic unavailable'))
    .mockImplementation(async () => liveFrame(run));
  mount();
  expect(await screen.findByText('Live metrics unavailable. Figures are unknown.')).toBeVisible();
  expect(screen.queryByText('1,200')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', {name:'Retry live metrics'}));
  expect(await screen.findByText('1,200')).toBeVisible();
  expect(read).toHaveBeenCalledTimes(2);
});
