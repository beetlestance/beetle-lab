// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ApiContext } from '../../../app/api.js';
import { testClient } from '../../../app/test-fixtures.js';
import type { ArtifactRead } from '../../../lib/verified-artifact.js';
import type { ArtifactReader } from '../../../lib/use-artifact-report.js';
import { RunPerformanceReport } from './index.js';
import { artifact, deferred, input, params, report } from './fixtures.js';
afterEach(() => {cleanup(); vi.useRealTimers(); vi.restoreAllMocks();});
function session() {return testClient(async () => {throw new Error('Unexpected API request');}).client;}
function surface(api: ReturnType<typeof session>, reads: ArtifactReader<string>, selection = input()) {
  return <ApiContext.Provider value={api}><RunPerformanceReport {...selection} reads={reads} /></ApiContext.Provider>;
}
it('renders plain text, never executes report HTML, and exposes only scoped fixed-name download', async () => {
  render(surface(session(), {read: async () => report}));
  const body = await screen.findByRole('region', {name: 'Verified performance report'});
  expect(body.textContent).toBe(report); expect(body.querySelector('script')).toBeNull();
  const link = screen.getByRole('link', {name: 'Download text report'});
  expect(link).toHaveAttribute('download', `artifact-${artifact.artifactId}.txt`);
  expect(link.getAttribute('href')).toContain(`/runs/${params.runId}/attempts/${params.attemptId}/artifacts/${artifact.artifactId}/content`);
});
it.each(['scope', 'attempt', 'session'] as const)('retires previous values and late replies across %s changes', async kind => {
  const held = deferred<string>(); const signals: AbortSignal[] = []; let count = 0;
  const reads = {read: vi.fn(async (request: ArtifactRead) => {signals.push(request.signal); return ++count === 1 ? report : held.promise;})};
  const api = session(); const view = render(surface(api, reads)); await screen.findByRole('region', {name: 'Verified performance report'});
  const next = input(); if (kind === 'scope') next.params.organizationId = '00000000-0000-4000-8000-000000000009';
  if (kind === 'attempt') next.params.attemptId = '00000000-0000-4000-8000-000000000009';
  view.rerender(surface(kind === 'session' ? session() : api, reads, next));
  expect(screen.queryByRole('region', {name: 'Verified performance report'})).toBeNull(); expect(signals[0]!.aborted).toBe(true);
  await waitFor(() => expect(reads.read).toHaveBeenCalledTimes(2)); view.unmount(); expect(signals[1]!.aborted).toBe(true);
  await act(async () => {held.resolve('retired');}); expect(screen.queryByText('retired')).toBeNull();
});
it('times out display while the ignored-abort original stays owned, and never shows its late success', async () => {
  vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']}); const held = deferred<string>(); let signal!: AbortSignal;
  const reads = {read: vi.fn(async (request: ArtifactRead) => {signal = request.signal; return held.promise;})};
  render(surface(session(), reads)); await act(async () => {await Promise.resolve();});
  await act(() => vi.advanceTimersByTimeAsync(5000)); expect(screen.getByRole('alert')).toHaveTextContent('could not be verified');
  expect(signal.aborted).toBe(true); expect(screen.getByRole('button', {name: 'Reload performance report'})).toBeEnabled();
  await act(async () => {held.resolve(report);}); expect(screen.queryByRole('region', {name: 'Verified performance report'})).toBeNull();
});
it('retries only on explicit request and survives StrictMode without an abandoned fetch', async () => {
  const reads = {read: vi.fn<ArtifactReader<string>['read']>().mockRejectedValueOnce(new Error('private detail')).mockResolvedValueOnce(report)};
  render(<StrictMode>{surface(session(), reads)}</StrictMode>); await screen.findByRole('alert');
  expect(reads.read).toHaveBeenCalledTimes(1); expect(screen.queryByText('private detail')).toBeNull();
  fireEvent.click(screen.getByRole('button', {name: 'Reload performance report'}));
  await screen.findByRole('region', {name: 'Verified performance report'}); expect(reads.read).toHaveBeenCalledTimes(2);
});
