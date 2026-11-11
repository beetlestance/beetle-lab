// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { focusManager } from '@tanstack/react-query';
import { json, mountMetrics, page, samples, testClient } from './fixtures.js';
import { pendingMetrics, run } from '../test-fixtures.js';
afterEach(() => {cleanup(); vi.useRealTimers(); focusManager.setFocused(undefined);});
it('polls pending every two visible seconds and stops on absent publication', async () => {
  vi.useFakeTimers({toFake: ['setInterval', 'clearInterval']}); let calls = 0;
  const f = testClient(() => json(++calls < 3 ? pendingMetrics() : {...pendingMetrics(), availability: 'absent'}));
  mountMetrics(f.client); await screen.findByText('Metric publication is pending.');
  await act(() => vi.advanceTimersByTimeAsync(1999)); expect(calls).toBe(1);
  await act(() => vi.advanceTimersByTimeAsync(1)); await waitFor(() => expect(calls).toBe(2));
  act(() => focusManager.setFocused(false)); await act(() => vi.advanceTimersByTimeAsync(6000)); expect(calls).toBe(2);
  act(() => focusManager.setFocused(true)); await act(() => vi.advanceTimersByTimeAsync(2000));
  await screen.findByText('No metric source was published for this attempt.'); expect(calls).toBe(3);
  await act(() => vi.advanceTimersByTimeAsync(6000)); expect(calls).toBe(3);
});
it('keeps explicit unsupported/error states and retries only after manual refresh', async () => {
  vi.useFakeTimers({toFake: ['setInterval', 'clearInterval']});
  const f = testClient(() => json({...pendingMetrics(), availability: 'unavailable', reason: 'unsupported_format', manifestDigest: 'c'.repeat(64)}));
  mountMetrics(f.client); await screen.findByText('This metric history format is unsupported.');
  await act(() => vi.advanceTimersByTimeAsync(6000)); expect(f.records).toHaveLength(1);
  await act(async () => {fireEvent.click(screen.getByRole('button', {name: 'Refresh metrics'}));});
  expect(f.records).toHaveLength(2);
});
it('shows histogram p95 source bounds and scale, whole-run totals and no raw archive identity', async () => {
  const estimate = {source: 'histogram-estimate' as const, scale: 4, estimate: 3, lower: 2.9, upper: 3.1};
  const value = {kind: 'trend' as const, count: 10, sum: 30, min: 1, max: 5, mean: 3,
    percentiles: {p50: estimate, p90: estimate, p95: estimate, p99: estimate}};
  const descriptor = {...page().items[0]!, metric: 'http_req_duration', kind: 'trend' as const, unit: 'ms' as const, total: value};
  const p = {...page(), windows: 1, items: [descriptor]};
  const sample = {...samples(1, 1), windows: 1, series: descriptor, items: [{windowOrdinal: 1, startTimeMs: 2000, endTimeMs: 3000, value}], nextCursor: null};
  const f = testClient(request => json(request.path.includes('/samples?') ? sample : p)); mountMetrics(f.client);
  await screen.findByRole('img'); expect(screen.getByText(/Whole-run total/)).toBeVisible();
  expect(screen.getByText(/Chart shows estimated p95/)).toBeVisible();
  fireEvent.click(screen.getByText('Source samples and estimate bounds'));
  expect(screen.getAllByText(/bounds 2.9–3.1 ms; scale 4/).length).toBeGreaterThan(0);
  expect(document.body.textContent).not.toContain('cccccccccccccccc');
});
it('preserves null sample ratios rather than drawing measured zero', async () => {
  const value = {kind: 'rate' as const, numerator: 0, sampleCount: 0, ratio: null};
  const descriptor = {...page().items[0]!, metric: 'http_req_failed', kind: 'rate' as const, unit: 'ratio' as const, total: value};
  const f = testClient(request => json(request.path.includes('/samples?') ? {...samples(1, 1), windows: 1, series: descriptor,
    items: [{windowOrdinal: 1, startTimeMs: 2000, endTimeMs: 3000, value}], nextCursor: null} : {...page(), windows: 1, items: [descriptor]}));
  mountMetrics(f.client); await screen.findByRole('img'); expect(document.querySelectorAll('.metric-dot')).toHaveLength(0);
  expect(screen.getByText(/Chart shows ratios of recorded samples/)).toBeVisible();
  expect(run().scope.kind).toBe('workspace');
});
