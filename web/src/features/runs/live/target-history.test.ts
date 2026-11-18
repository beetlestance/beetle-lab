import { expect, it } from 'vitest';
import { targetMetricNames } from '@beetle/contracts/target-runtime';
import { captureLiveMetricHistory } from '@beetle/contracts/api';
import data from '../../../../../contracts/fixtures/api/valid/live-target-history.json' with { type: 'json' };
import { appendFrame, emptyHistory } from './history.js';
import { historyMatches, mergeHistory } from './backfill.js';
import { currentFrame, rememberTarget } from './current.js';
import { liveFrame, liveRun, config } from './fixtures.js';
import { liveFigures } from './model.js';
import { readPlan } from './plan.js';

const plan = readPlan(config);
function archived(count = 3) {
  const value = captureLiveMetricHistory(data, () => data.subsetDigest);
  const sample = value.targetSamples![0]!;
  value.targetSamples = Array.from({ length: count }, (_, index) => ({ ...sample,
    observedAt: new Date(index * 1000).toISOString(), phase: index === 0 ? 'before' as const : 'during' as const,
    values: { ...sample.values, rss: index + 1, 'gc.totalMs': index + 2 } }));
  value.prefix.target!.samples = count; value.prefix.target!.data.bytes = 1024 + count * 2048;
  return value;
}
function frameFor(value = archived()) {
  return { ...liveFrame(liveRun(), 1).frame, scope: value.scope, producerEpoch: value.producerEpoch,
    subsetDigest: value.subsetDigest, archivePrefix: value.prefix };
}
it('backfills earlier target observations, all known values and phases while rebasing times', () => {
  const value = archived(); const frame = frameFor(value);
  let history = appendFrame(emptyHistory(null), frame, liveFigures(frame, plan));
  history = mergeHistory(history, value, plan, new Date(1000).toISOString());
  const recorded = history.target.filter(point => point.archiveSequence !== null);
  expect(recorded.map(point => point.t)).toEqual([-1000, 0, 1000]);
  expect(recorded.map(point => point.phase)).toEqual(['before', 'during', 'during']);
  expect(recorded[0]?.values['gc.totalMs']).toBe(2);
  expect(history.targetCoverage).toEqual({ samples: 3, dataArtifactId: value.prefix.target!.data.artifactId });
  expect(history.intervalMs).toBe(1000);
  value.targetSamples![0]!.values.rss = 999;
  expect(recorded[0]?.values.rss).toBe(1);
});
it('uses recorded ordinals to preserve distinct samples with identical source UTC timestamps', () => {
  const value = archived(); value.targetSamples![2]!.observedAt = value.targetSamples![1]!.observedAt;
  const history = mergeHistory(emptyHistory(null), value, plan, null);
  expect(history.target).toHaveLength(3);
  expect(history.target.map(point => point.archiveSequence)).toEqual([1, 2, 3]);
  expect(history.target.at(-1)?.gapBefore).toBe(true);
});
it('prefers the full recorded observation over an overlapping live projection, then accepts later live readings', () => {
  const value = archived(); const frame = frameFor(value);
  frame.target = { intervalMs: 1000, omittedSamples: 0, scope: 'target-reported', samples: [{ ...frame.target!.samples[0]!,
    observedAtMs: 2000, phase: 'during', values: { ...frame.target!.samples[0]!.values, rss: 3 } }] };
  let history = appendFrame(emptyHistory(null), frame, liveFigures(frame, plan));
  history = mergeHistory(history, value, plan, null);
  expect(history.target).toHaveLength(3); expect(history.target[2]?.archiveSequence).toBe(3);
  expect(history.target[2]?.values['gc.totalMs']).toBe(4);
  const next = { ...frame, publishedSequence: frame.publishedSequence + 1, target: { ...frame.target,
    samples: [{ ...frame.target.samples[0]!, observedAtMs: 3000 }] } };
  history = appendFrame(history, next, liveFigures(next, plan));
  expect(history.target).toHaveLength(4); expect(history.target.at(-1)?.archiveSequence).toBeNull();
  expect(history.target.at(-1)?.values['gc.totalMs']).toBeNull();
  expect(history.targetCoverage?.samples).toBe(3);
});
it('retains complete recorded prefixes on overlapping refreshes and stays below the target bound', () => {
  const value = archived(256);
  for (const sample of value.targetSamples!) {
    for (const key of targetMetricNames) sample.values[key] = Number.MAX_VALUE;
  }
  let history = mergeHistory(emptyHistory(null), value, plan, null);
  history = mergeHistory(history, value, plan, null);
  const older = archived(100); history = mergeHistory(history, older, plan, null);
  expect(history.target).toHaveLength(256); expect(history.targetCoverage?.samples).toBe(256);expect(history.targetLimited).toBe(true);
  expect(history.target[0]?.values.rss).toBe(Number.MAX_VALUE);
  expect(new TextEncoder().encode(JSON.stringify(history.target)).length).toBeLessThan(1048576);
});
it('checks target archive identity, interval and equal-count hashes against retained current authority', () => {
  const value = archived(); const current = currentFrame(frameFor(value), 1000, null).latest;
  const absent = { ...current.frame, archivePrefix: { ...current.frame.archivePrefix! } }; delete absent.archivePrefix.target;
  const latest = currentFrame(absent, 2000, current).latest;
  expect(historyMatches(value, latest.frame, latest.targetPrefix)).toBe(true);
  for (const kind of ['id', 'interval', 'hash'] as const) {
    const wrong = archived();
    if (kind === 'id') wrong.prefix.target!.data.artifactId = '00000000-0000-4000-8000-000000000099';
    if (kind === 'interval') wrong.prefix.target!.intervalMs = 2000;
    if (kind === 'hash') wrong.prefix.target!.data.sha256 = 'd'.repeat(64);
    expect(historyMatches(wrong, latest.frame, latest.targetPrefix)).toBe(false);
  }
  const bound = rememberTarget({ frame: absent, receivedWall: 2000 }, value.prefix.target);
  const bytes = value.prefix.target!.data.bytes; value.prefix.target!.data.bytes = 1;
  expect(bound.targetPrefix?.data.bytes).toBe(bytes);
});
it('retires target authority when the approved producer owner changes and rejects unplottable times', () => {
  const value = archived(); const prior = currentFrame(frameFor(value), 1000, null).latest;
  const frame = { ...prior.frame, producerEpoch: '00000000-0000-4000-8000-000000000099' }; delete frame.archivePrefix;
  const next = currentFrame(frame, 2000, prior);
  expect(next.changed).toBe(true); expect(next.latest.targetPrefix).toBeUndefined();
  value.targetSamples![0]!.observedAt = '2026-12-31T23:59:60Z';
  expect(historyMatches(value, prior.frame)).toBe(false);
});

it('uses detached target authority rather than a returned frame mutated after capture',()=>{
 const value=archived();const current=currentFrame(frameFor(value),1000,null).latest;
 current.frame.archivePrefix!.target!.data.sha256='f'.repeat(64);
 expect(historyMatches(archived(),current.frame,current.targetPrefix)).toBe(true);
 const wrongInterval={...current.frame,target:{...current.frame.target!,intervalMs:2000}};
 delete wrongInterval.archivePrefix;
 expect(historyMatches(archived(),wrongInterval)).toBe(false);
});

it('does not infer the producer limit from the browser buffer reaching capacity',()=>{
 const run=liveRun();let history=emptyHistory(null);
 for(let sequence=1;sequence<=256;sequence++){
  const frame=liveFrame(run,sequence).frame;
  const observedAtMs=sequence*1000;
  frame.startTimeMs=observedAtMs-1000;frame.endTimeMs=observedAtMs;
  frame.target!.samples=[{...frame.target!.samples.at(-1)!,observedAtMs}];
  history=appendFrame(history,frame,liveFigures(frame,plan));
 }
 expect(history.target).toHaveLength(256);expect(history.targetLimited).toBe(false);
});
