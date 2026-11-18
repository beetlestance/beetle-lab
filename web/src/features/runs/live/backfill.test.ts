import { expect, it } from 'vitest';
import data from '../../../../../contracts/fixtures/api/valid/live-metric-history.json' with { type: 'json' };
import { captureLiveMetricHistory } from '@beetle/contracts/api';
import { historyMatches, mergeHistory, recordedCount } from './backfill.js';
import { appendFrame, emptyHistory, mergePoints, HISTORY_LIMIT } from './history.js';
import { config, liveFrame, liveRun } from './fixtures.js';
import { liveFigures } from './model.js';
import { readPlan } from './plan.js';
const archived = () => captureLiveMetricHistory(data, () => data.subsetDigest);
const plan = readPlan(config);
it('keeps archive window ordinals independent of live publication sequence', () => {
  const value = archived();
  const frame = {
    ...liveFrame(liveRun()).frame,
    publishedSequence: 1,
    sourceSequence: 1000,
    startTimeMs: 999000,
    endTimeMs: 1000000,
  };
  let history = appendFrame(emptyHistory(null), frame, liveFigures(frame, plan));
  history = mergeHistory(history, value, plan, null);
  expect(history.lastPublishedSequence).toBe(1);
  expect(recordedCount(history)).toBe(1);
  const next = { ...frame, publishedSequence: 2, sourceSequence: 1001, startTimeMs: 1000000, endTimeMs: 1001000 };
  history = appendFrame(history, next, liveFigures(next, plan));
  expect(history.lastPublishedSequence).toBe(2);
  expect(history.points.at(-1)?.t).toBe(1001000);
});
it('deduplicates an overlapping window while preserving both sequence domains', () => {
  const value = archived();
  const frame = {
    ...liveFrame(liveRun()).frame,
    publishedSequence: 1,
    sourceSequence: 17,
    startTimeMs: 0,
    endTimeMs: 1000,
  };
  const initial = appendFrame(emptyHistory(null), frame, liveFigures(frame, plan));
  const history = mergeHistory(initial, value, plan, null);
  expect(history.points).toHaveLength(1);
  expect(history.points[0]).toMatchObject({ archiveSequence: 1, feedSourceSequence: 17, t: 1000 });
});
it('joins deliberately sampled windows but breaks for missing source time', () => {
  const frame = liveFrame(liveRun()).frame;
  const point = appendFrame(emptyHistory(null), frame, liveFigures(frame, plan)).points[0]!;
  const samples = [
    { ...point, t: 1000, archiveSequence: 1 },
    { ...point, t: 10000, archiveSequence: 10 },
    { ...point, t: 12000, archiveSequence: 11 },
  ];
  expect(mergePoints([], samples).map((p) => p.gapBefore)).toEqual([false, false, true]);
});
it('bounds projected points and retains actual endpoints while rebasing the origin', () => {
  const value = archived();
  const frame = liveFrame(liveRun()).frame;
  const point = appendFrame(emptyHistory(null), frame, liveFigures(frame, plan)).points[0]!;
  const many = Array.from({ length: 1000 }, (_, i) => ({ ...point, t: (i + 1) * 1000, archiveSequence: i + 1 }));
  const reduced = mergePoints([], many);
  expect(reduced).toHaveLength(HISTORY_LIMIT);
  expect(reduced[0]?.t).toBe(1000);
  expect(reduced.at(-1)?.t).toBe(1000000);
  const history = mergeHistory(
    { ...emptyHistory(null), originMs: 5000, points: [{ ...point, t: 1000 }] },
    value,
    plan,
    new Date(0).toISOString(),
  );
  expect(history.points.map((p) => p.t)).toEqual([1000, 6000]);
  expect(history.fromStart).toBe(true);
});
it('requires the current scope, epoch, subset and captured artifact pair', () => {
  const value = archived();
  const frame = {
    ...liveFrame(liveRun()).frame,
    scope: value.scope,
    producerEpoch: value.producerEpoch,
    subsetDigest: value.subsetDigest,
    archivePrefix: value.prefix,
  };
  expect(historyMatches(value, frame)).toBe(true);
  expect(historyMatches(value, { ...frame, scope: { ...frame.scope, generation: 2 } })).toBe(false);
  expect(historyMatches(value, { ...frame, producerEpoch: '00000000-0000-4000-8000-000000000099' })).toBe(false);
  expect(historyMatches(value, { ...frame, subsetDigest: 'f'.repeat(64) })).toBe(false);
  expect(
    historyMatches(value, {
      ...frame,
      archivePrefix: {
        ...value.prefix,
        data: { ...value.prefix.data, artifactId: '00000000-0000-4000-8000-000000000099' },
      },
    }),
  ).toBe(false);
});
