// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LiveMetricReads } from '../live-metrics/read.js';
import { HistoryReads } from '../live-history/read.js';
import { json, liveFrame, liveRun, mountLive, routesFor, revision } from './fixtures.js';
import { targetMetricNames } from '@beetle/contracts/target-runtime';
import type { TargetRuntimeUnits } from '@beetle/contracts/target-runtime';
import { TargetRuntime } from './Charts.js';
import { emptyHistory } from './history.js';
import type { TargetPoint } from './history.js';
import { liveTargetCharts } from './target-charts.js';
import { targetCardReading } from '../charts/target-format.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function point(values: Partial<TargetPoint['values']>, patch: Partial<TargetPoint> = {}): TargetPoint {
  return Object.freeze({
    t: 1000,
    observedAtMs: 1000,
    archiveSequence: 1,
    phase: 'during',
    gapBefore: false,
    status: 'ready',
    reason: null,
    values: Object.freeze(Object.fromEntries(targetMetricNames.map((key) => [key, values[key] ?? null]))),
    ...patch,
  }) as TargetPoint;
}
const units: TargetRuntimeUnits = {
  heapAlloc: 'bytes',
  rss: 'mebibytes',
  cpuPercent: 'ratio',
  systemCpuPercent: 'percent',
  'eventLoopDelay.mean': 'seconds',
  'eventLoopDelay.p99': 'microseconds',
  'eventLoopDelay.max': 'nanoseconds',
  activeHandles: 'count',
};
const observed = point({
  heapAlloc: 1e6,
  rss: 2,
  cpuPercent: 0.64,
  systemCpuPercent: 38,
  'eventLoopDelay.mean': 0.0095,
  'eventLoopDelay.p99': 22000,
  'eventLoopDelay.max': 32400000,
  activeHandles: 0,
});

it('normalizes compatible declared memory, CPU, time and count sources without changing observations', () => {
  const cards = liveTargetCharts([observed], units);
  expect(cards.map((card) => card.unit)).toEqual(['MB', '%', 'ms', 'count']);
  expect(cards.map((card) => card.series.map((line) => line.values))).toEqual([
    [[1], [2.097152]],
    [[64], [38]],
    [[9.5], [22], [32.4]],
    [[0]],
  ]);
  expect(observed.values.heapAlloc).toBe(1e6);
  expect(observed.values.cpuPercent).toBe(0.64);
});

it('keeps a whole group raw when one known series lacks units and labels each source explicitly', () => {
  const card = liveTargetCharts([observed], { rss: 'mebibytes' })[0]!;
  expect(card.normalized).toBe(false);
  expect(card.series.map((line) => [line.label, line.values])).toEqual([
    ['heap (raw)', [1e6]],
    ['RSS (MiB)', [2]],
  ]);
});

it('does not let an absent reading prevent conversion, and never treats an unavailable sample as known', () => {
  const cards = liveTargetCharts([point({ heapAlloc: 0 })], { heapAlloc: 'bytes' });
  expect(cards[0]!.normalized).toBe(true);
  expect(cards[0]!.series.map((line) => line.values)).toEqual([[0], [null]]);
  expect(liveTargetCharts([point({ heapAlloc: 999 }, { status: 'unavailable', reason: 'http' })], units)).toEqual([]);
});

it('uses Go heap-inuse and goroutine readings when the other runtime keys are absent', () => {
  const cards = liveTargetCharts([point({ heapInuse: 2e6, goroutines: 0 })], {
    heapInuse: 'bytes',
    goroutines: 'count',
  });
  expect(cards.map((card) => card.title)).toEqual(['Heap and RSS', 'Goroutines']);
  expect(cards.map((card) => card.series[0]!.values)).toEqual([[2], [0]]);
});

it('withholds overflowing or underflowing projections and displays positive tiny values without rounding to zero', () => {
  const cards = liveTargetCharts([point({ heapAlloc: Number.MIN_VALUE, cpuPercent: Number.MAX_VALUE })], units);
  expect(cards.map((card) => card.series[0]!.values)).toEqual([[null], [null]]);
  expect(targetCardReading({ normalized: true, unit: 'MB' }, 1e-12)).toBe('1.00e-12 MB');
  expect(targetCardReading({ normalized: true, unit: '%' }, 0)).toBe('0%');
});

it('renders converted legends while retaining source times, gaps and explicit raw fallback', () => {
  const history = {
    ...emptyHistory(new Date(0).toISOString()),
    target: [observed, point({ heapAlloc: 0, rss: 0 }, { t: 3000, observedAtMs: 3000, gapBefore: true })],
  };
  const view = render(
    <TargetRuntime
      history={history}
      domain={[0, 4000]}
      origin="target:8080"
      hover={{ hoverT: null, onHover: () => undefined }}
      units={units}
    />,
  );
  expect(screen.getByRole('img', { name: 'Heap and RSS: heap 0 MB, RSS 0 MB' })).toBeVisible();
  expect(
    screen.getByRole('img', { name: 'Heap and RSS: heap 0 MB, RSS 0 MB' }).querySelectorAll('.live-single-point'),
  ).toHaveLength(4);
  view.rerender(
    <TargetRuntime
      history={history}
      domain={[0, 4000]}
      origin="target:8080"
      hover={{ hoverT: 2000, onHover: () => undefined }}
      units={units}
    />,
  );
  expect(screen.getByRole('img', { name: 'Heap and RSS: heap no reading, RSS no reading' })).toBeVisible();
  view.rerender(
    <TargetRuntime
      history={history}
      domain={[0, 4000]}
      origin="target:8080"
      hover={{ hoverT: null, onHover: () => undefined }}
    />,
  );
  expect(screen.getByRole('img', { name: 'Heap and RSS: heap (raw) 0, RSS (raw) 0' })).toBeVisible();
  expect(history.target.map((p) => [p.t, p.gapBefore])).toEqual([
    [1000, false],
    [3000, true],
  ]);
});

it('normalizes declared CPU ratios and percentages from the pinned revision', async () => {
  const current = liveRun({ startedAt: new Date(Date.now() - 316_000).toISOString() });
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.spyOn(HistoryReads.prototype, 'read').mockRejectedValue(Error('Synthetic history unavailable'));
  vi.spyOn(LiveMetricReads.prototype, 'read').mockResolvedValue(liveFrame(current, 1));
  const saved = revision();
  const fixture = routesFor(
    () => current,
    (request) =>
      request.path.includes('/revisions/')
        ? json({
            ...saved,
            config: {
              ...saved.config,
              targetSampling: {
                path: '/metrics',
                intervalMs: 1000,
                timeoutMs: 100,
                cooldownMs: 0,
                units: { cpuPercent: 'ratio', systemCpuPercent: 'percent' },
              },
            },
          })
        : undefined,
  );
  mountLive(fixture.client, { run: current });
  expect(await screen.findByRole('img', { name: /CPU: process [\d,]+%/ })).toBeVisible();
  expect(screen.getByRole('img', { name: /CPU: process [\d,]+%/ })).toHaveAccessibleName(/system [\d,]+%/);
});
