import { expect, it } from 'vitest';
import { captureTargetRuntimeReport, targetMetricNames } from '@beetle/contracts/target-runtime';
import type { TargetMetricName, TargetRuntimePhase } from '@beetle/contracts/target-runtime';
import { observationSummary } from './summary.js';
function sample(phase: TargetRuntimePhase, value: number | null, index: number, metric: TargetMetricName = 'rss') {
  return {observedAt: new Date(1767225600000 + index * 1000).toISOString(), phase,
    status: value === null ? 'unavailable' : 'ready', reason: value === null ? 'timeout' : null,
    values: Object.fromEntries(targetMetricNames.map(name => [name, name === metric ? value : null]))};
}
function report(samples: ReturnType<typeof sample>[]) {
  return captureTargetRuntimeReport({format: 'beetle-target-runtime', version: 1, scope: 'target-reported',
    samples, limited: false, missed: samples.filter(row => row.status === 'unavailable').length});
}
it('does not substitute earlier known after points for an unavailable final observation', () => {
  const value = report([sample('before', null, 0), sample('during', 0, 1), sample('during', 5, 2), sample('after', 7, 3), sample('after', null, 4)]);
  expect(observationSummary(value, 'rss')).toMatchObject({baseline: null, peak: 5, final: null, delta: null, percent: null, known: 3, investigateMemory: false});
});
it('preserves measured zero and leaves the undefined zero-baseline percentage unknown', () => {
  const value = report([sample('before', 0, 0), sample('after', 0, 1)]);
  expect(observationSummary(value, 'rss')).toMatchObject({baseline: 0, final: 0, delta: 0, percent: null, investigateMemory: false});
});
it('restricts memory follow-up heuristics to memory readings, not expected uptime growth', () => {
  expect(observationSummary(report([sample('before', 10, 0), sample('after', 20, 1)]), 'rss')).toMatchObject({delta: 10, percent: 100, investigateMemory: true});
  expect(observationSummary(report([sample('before', 10, 0, 'uptime'), sample('after', 20, 1, 'uptime')]), 'uptime').investigateMemory).toBe(false);
});
it('keeps extreme finite point differences and refuses an overflowing ratio', () => {
  const value = report([sample('before', Number.MIN_VALUE, 0), sample('after', Number.MAX_VALUE, 1)]);
  const summary = observationSummary(value, 'rss'); expect(Number.isFinite(summary.delta)).toBe(true); expect(summary.percent).toBeNull();
});
it('flags backwards or unplottable observation times before showing a growth heuristic', () => {
  const value = report([sample('before', 10, 1), sample('after', 20, 0)]);
  expect(observationSummary(value, 'rss')).toMatchObject({clockOrdered: false, investigateMemory: false});
  const leap = {...value, samples: [{...value.samples[0]!, observedAt: '2016-12-31T23:59:60.000Z'}]};
  expect(observationSummary(leap, 'rss').clockOrdered).toBe(false);
});

it('suppresses comparisons and follow-up signals when phase chronology contradicts time order', () => {
  const value = report([sample('after', 20, 0), sample('before', 10, 1)]);
  expect(observationSummary(value, 'rss')).toMatchObject({clockOrdered: true, phaseOrdered: false, delta: null, percent: null, investigateMemory: false});
});
