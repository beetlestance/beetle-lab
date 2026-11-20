import { expect, it } from 'vitest';
import { scenarioStartedMetric } from '../../../plan/index.js';
import type { MetricPoint } from '../../../aggregation/index.js';
import { marker, point, setup, signal } from './fixtures.js';

const origin = (value: number, timeMs: number): MetricPoint => ({
  metric: scenarioStartedMetric,
  kind: 'gauge',
  value,
  timeMs,
  tags: {},
});

it('keeps the native scenario origin out of metric totals and windows even when it arrives before the setup marker', async () => {
  const { accumulator, feed, windows } = setup();
  await feed(origin(1500, 1510));
  await feed(marker());
  await feed(point('beetle_requests', 1, 1600));
  const snapshot = await accumulator.finish(signal());
  expect(snapshot.scenarioStartedAtMs).toBe(1500);
  expect(snapshot.measurement.sourceTimeMs).toBe(1000);
  expect(snapshot.totals.map((series) => series.metric)).toEqual(['beetle_requests']);
  expect(windows).toHaveLength(1);
});

it.each([
  [],
  [origin(900, 1510)],
  [origin(1511, 1510)],
  [origin(1500.5, 1510)],
  [origin(1500, 1510), origin(1500, 1520)],
])('withholds absent, inconsistent or duplicate optional scenario evidence (%#)', async (...observations) => {
  const { accumulator, feed } = setup();
  await feed(marker());
  for (const observation of observations) await feed(observation);
  expect((await accumulator.finish(signal())).scenarioStartedAtMs).toBeUndefined();
});
