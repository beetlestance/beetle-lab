// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { SuiteLatestRun } from '@beetle/contracts/api';
import { SessionContext } from '../../app/session.js';
import { LatestDuration } from './LatestDuration.js';
import { useRunClock } from './useRunClock.js';

const latest: SuiteLatestRun = {
  suiteId: '00000000-0000-4000-8000-000000000001', runId: '00000000-0000-4000-8000-000000000002',
  suiteName: 'Load', state: 'active', outcome: 'pending', requestedAt: '2026-11-01T00:00:00.000Z',
  startedAt: '2026-11-10T00:00:00Z', testDurationMs: null,
};
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
it('shows actual runtime elapsed rather than request age', () => {
  render(<LatestDuration run={latest} now={Date.parse(latest.startedAt!) + 316000} />);
  expect(screen.getByText('05:16 so far')).toBeVisible();
});
it.each([null, 'not-a-timestamp', '2099-01-01T00:00:00Z'])('keeps absent, unparseable and future starts unknown: %s', startedAt => {
  render(<LatestDuration run={{ ...latest, startedAt }} now={Date.parse('2026-11-10T00:01:00Z')} />);
  expect(screen.getByText(startedAt?.startsWith('2099') ? 'Start time ahead of browser' : 'Start time unavailable')).toBeVisible();
  expect(screen.queryByText('00:00 so far')).not.toBeInTheDocument();
});
it('uses measured duration for a terminal run, distinguishing null from measured zero', () => {
  const run: SuiteLatestRun = { ...latest, state: 'finished', outcome: 'failed', testDurationMs: 60000 };
  const view = render(<LatestDuration run={run} now={Date.now()} />);
  expect(screen.getByText('Took 01:00')).toBeVisible();
  view.rerender(<LatestDuration run={{ ...run, testDurationMs: null }} now={Date.now()} />);
  expect(screen.getByText('Duration not recorded')).toBeVisible();
  view.rerender(<LatestDuration run={{ ...run, testDurationMs: 0 }} now={Date.now()} />);
  expect(screen.getByText('Took 00:00')).toBeVisible();
});
it('owns one clock, pauses it in hidden tabs and clears it on retirement', () => {
  vi.useFakeTimers(); vi.setSystemTime(1000);
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  const view = renderHook(({ active }) => useRunClock(active), { initialProps: { active: true } });
  expect(vi.getTimerCount()).toBe(1);
  act(() => vi.advanceTimersByTime(1000)); expect(view.result.current).toBe(2000);
  visibility.mockReturnValue('hidden');
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(vi.getTimerCount()).toBe(0);
  act(() => vi.advanceTimersByTime(10000)); expect(view.result.current).toBe(2000);
  visibility.mockReturnValue('visible');
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(view.result.current).toBe(12000); expect(vi.getTimerCount()).toBe(1);
  view.rerender({ active: false }); expect(vi.getTimerCount()).toBe(0);
  view.unmount(); expect(vi.getTimerCount()).toBe(0);
});

it('does not present a restored unfinished run as currently elapsed', () => {
  render(<SessionContext.Provider value={{ readOnly: true, restoredBackup: { backupId: latest.runId, createdAt: '2026-11-12T02:00:00.000Z' } }}>
    <LatestDuration run={latest} now={Date.now()} />
  </SessionContext.Provider>);
  expect(screen.getByText('State at backup')).toBeVisible();
  expect(screen.queryByText(/so far/)).not.toBeInTheDocument();
});
