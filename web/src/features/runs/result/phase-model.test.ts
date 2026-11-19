import { expect, it } from 'vitest';
import { captureTargetRuntimeReport, targetMetricNames } from '@beetle/contracts/target-runtime';
import type { TargetMetricName, TargetRuntimePhase, TargetRuntimeUnits } from '@beetle/contracts/target-runtime';
import { targetPhaseSummary, phaseNumber } from './phase-model.js';
const epoch = 1700000000000;
function sample(at: number, phase: TargetRuntimePhase, values: Partial<Record<TargetMetricName, number>> = {}) {
  return {observedAt: new Date(epoch + at).toISOString(), phase, status: 'ready', reason: null,
    values: Object.fromEntries(targetMetricNames.map(key => [key, values[key] ?? null]))};
}
function report(samples: ReturnType<typeof sample>[], units?: TargetRuntimeUnits) {
  return captureTargetRuntimeReport({format: 'beetle-target-runtime', version: 1, scope: 'target-reported', samples, limited: false, missed: 0, ...(units ? {units} : {})});
}
const units: TargetRuntimeUnits = {rss: 'bytes', 'gc.count': 'count', 'gc.totalMs': 'milliseconds', cpuPercent: 'ratio'};
it('uses exact before/after points, known during gauge mean, compatible units and percentage points', () => {
  const data = report([sample(-1000, 'before', {rss: 1000000, cpuPercent: 0}), sample(0, 'during', {rss: 4000000, cpuPercent: .2}), sample(1000, 'during', {rss: 6000000, cpuPercent: .4}), sample(2000, 'after', {rss: 0})], units);
  const summary = targetPhaseSummary(data);
  expect(summary.rows.find(row => row.name === 'RSS')).toMatchObject({values: [1, 5, 0], delta: 4, unit: 'MB'});
  const cpu = summary.rows.find(row => row.name === 'CPU (process)')!;
  expect(cpu.values[0]).toBe(0); expect(cpu.values[1]).toBeCloseTo(30); expect(cpu.values[2]).toBeNull();
  expect(cpu.delta).toBeCloseTo(30); expect(cpu.deltaUnit).toBe('pp');
  expect(summary.spans).toEqual([null, 1000, null]);
});
it('derives GC interval rates and mean pauses from counters, never lifetime max/avg', () => {
  const data = report([sample(-1000, 'before', {'gc.count': 1, 'gc.totalMs': 5}), sample(0, 'during', {'gc.count': 3, 'gc.totalMs': 15, 'gc.maxMs': 999, 'gc.avgMs': 888}), sample(60000, 'during', {'gc.count': 9, 'gc.totalMs': 45}), sample(61000, 'after', {'gc.count': 9, 'gc.totalMs': 45}), sample(121000, 'after', {'gc.count': 9, 'gc.totalMs': 45})], units);
  const rows = targetPhaseSummary(data).rows;
  expect(rows.find(row => row.name === 'GC runs a minute')!.values).toEqual([null, 6, 0]);
  expect(rows.find(row => row.name === 'Time spent in GC')!.values).toEqual([null, .05, 0]);
  expect(rows.find(row => row.name === 'Average GC pause')!.values).toEqual([null, 5, null]);
  expect(rows.find(row => row.name === 'Longest GC pause')!.values).toEqual([null, null, null]);
});
it('does not backfill missing endpoints and keeps undeclared gauges raw without inferring counter units', () => {
  const data = report([sample(0, 'before'), sample(1000, 'before', {rss: 1}), sample(2000, 'during', {rss: 2, 'gc.count': 2}), sample(3000, 'during', {'gc.count': 3}), sample(4000, 'after', {rss: 3}), sample(5000, 'after')]);
  const rows = targetPhaseSummary(data).rows;
  expect(rows.find(row => row.name === 'RSS')).toMatchObject({values: [null, 2, null], delta: null, unit: 'raw'});
  expect(rows.find(row => row.name === 'GC runs a minute')!.values).toEqual([null, null, null]);
});
it('withdraws counter figures on clock rollback, target restart, phase disorder or cumulative reset', () => {
  const source = [sample(0, 'before', {rss: 1, uptime: 10}), sample(1000, 'during', {rss: 2, uptime: 11, 'gc.count': 10}), sample(2000, 'during', {rss: 3, uptime: 12, 'gc.count': 12})];
  for (const last of [sample(500, 'after', {rss: 1}), sample(3000, 'after', {uptime: 1}), sample(3000, 'before', {rss: 1})]) {
    const summary = targetPhaseSummary(report([...source, last], units));
    expect(summary.ordered).toBe(false);
    expect(summary.rows.every(row => row.delta === null)).toBe(true);
    expect(summary.rows.find(row => row.name === 'GC runs a minute')!.values).toEqual([null, null, null]);
  }
  const reset = targetPhaseSummary(report([...source, sample(3000, 'during', {'gc.count': 1})], units));
  expect(reset.rows.find(row => row.name === 'GC runs a minute')!.values).toEqual([null, null, null]);
});
it('keeps empty data, overflow and positive underflow unknown while formatting actual zero', () => {
  expect(targetPhaseSummary(report([])).rows.every(row => row.values.every(value => value === null))).toBe(true);
  const data = report([sample(0, 'during', {'gc.count': 0, 'gc.totalMs': 0}), sample(1000, 'during', {'gc.count': Number.MAX_VALUE, 'gc.totalMs': Number.MIN_VALUE})], units);
  const rows = targetPhaseSummary(data).rows;
  expect(rows.find(row => row.name === 'Average GC pause')!.values[1]).toBeNull();
  expect(rows.find(row => row.name === 'GC runs a minute')!.values[1]).toBeNull();
  expect(phaseNumber(0, '%')).toBe('0%');expect(phaseNumber(null, 'ms')).toBe('—');expect(phaseNumber(Number.MIN_VALUE, 'ms')).not.toBe('0 ms');
});

it('never turns a positive gauge mean that underflows into an observed zero', () => {
  const rows = targetPhaseSummary(report([sample(0, 'during', {cpuPercent: 0, rss: 0}), sample(1000, 'during', {cpuPercent: Number.MIN_VALUE, rss: 0})], units)).rows;
  expect(rows.find(row => row.name === 'CPU (process)')!.values[1]).toBeNull();
  expect(rows.find(row => row.name === 'RSS')!.values[1]).toBe(0);
});

it('uses only verified pauses between phase observations, including zero-length pauses', () => {
  const withPauses = (time: number, phase: TargetRuntimePhase, generation: number, through: number, recentMs: number[]) =>
    ({ ...sample(time, phase, { 'gc.maxMs': 500 }), gcWindow: { generation, through, recentMs } });
  const phases = [
    withPauses(0, 'before', 10, 1, [500]),
    withPauses(1000, 'before', 10, 2, [500, 5]),
    withPauses(2000, 'during', 10, 3, [500, 5, 89]),
    withPauses(3000, 'during', 10, 5, [5, 89, 8, 9]),
    withPauses(4000, 'after', 10, 6, [8, 9, 10]),
    withPauses(5000, 'after', 10, 7, [9, 10, 0]),
  ];
  const longest = (input: typeof phases) => targetPhaseSummary(report(input)).rows.find(row => row.name === 'Longest GC pause');
  expect(longest(phases)).toMatchObject({ values: [5, 9, 0], delta: 4 });
  const bridged = report([...phases.slice(0, 3), sample(2400, 'during'), ...phases.slice(3)]);
  expect(targetPhaseSummary(bridged).rows.find(row => row.name === 'Longest GC pause')?.values[1]).toBe(9);
  for (const conflict of [
    withPauses(3000, 'during', 11, 5, [5, 89, 8, 9]),
    withPauses(3000, 'during', 10, 8, [89, 8, 9]),
    withPauses(3000, 'during', 10, 5, [10, 89, 8, 9]),
    withPauses(3000, 'during', 10, 3, [500, 5, 89]),
  ]) {
    expect(longest([...phases.slice(0, 3), conflict, ...phases.slice(4)])?.values[1]).toBeNull();
  }
});
