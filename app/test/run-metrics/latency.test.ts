import { afterEach, expect, it } from 'vitest';
import { DurationHistogram } from '@beetle/contracts/metrics';
import { validateApi } from '@beetle/contracts/api';
import { riseOf } from '../../src/application/run-metrics/rise.js';
import type { RisePoint } from '../../src/application/run-metrics/rise.js';
import type { RunMetricsService } from '../../src/ports/run-metrics.js';
import { context, fixture, rebindPair, rewrite } from './fixture.js';
const services: RunMetricsService[] = [];
afterEach(async () => { await Promise.all(services.splice(0).map(service => service.close())); });
const T0 = 1800000000000;
function trend(value: number, count: number) {
  const h = new DurationHistogram(); for (let i = 0; i < count; i++) h.record(value);
  return {kind: 'trend', count, sum: value * count, min: value, max: value, mean: value, distribution: h.snapshot()};
}
const series = (request: string, value: number, count = 30) =>
  ({metric: 'http_req_duration', kind: 'trend', tags: {phase: 'execute', request}, scope: 'execute', total: trend(value, count)});
/** Rewrites the sealed pair as `n` adjacent windows; latency(i) gives [r0, r1] ms. */
async function archive(n: number, latency: (i: number) => [number, number]) {
  const f = await fixture(); const data = f.descriptors.find(a => a.kind === 'metric-windows')!;
  const header = f.contents.get(data.artifactId)!.toString('utf8').split('\n')[0]!;
  const lines = Array.from({length: n}, (_, i) => JSON.stringify({kind: 'window', sequence: i + 1, window: {startTimeMs: T0 + i * 1000,
    endTimeMs: T0 + i * 1000 + 1000, series: latency(i).map((ms, r) => series(`r${r}`, ms))}}));
  rewrite(f, 'metric-windows', () => [header, ...lines, JSON.stringify({kind: 'end', windows: n}), ''].join('\n'));
  let offset = Buffer.byteLength(header) + 1;
  rewrite(f, 'metric-index', text => [text.split('\n')[0], ...lines.map((line, i) => {
    const row = {sequence: i + 1, startTimeMs: T0 + i * 1000, endTimeMs: T0 + i * 1000 + 1000, offset, length: Buffer.byteLength(line) + 1};
    offset += row.length; return JSON.stringify(row);
  }), JSON.stringify({kind: 'end', windows: n, dataBytes: 0, dataSha256: '0'.repeat(64)}), ''].join('\n'));
  rewrite(f, 'numeric-final', text => {
    const value = JSON.parse(text); value.history.windows = n;
    value.metrics.totals.push({...value.metrics.totals[0], tags: {phase: 'execute', request: 'r1'}}); return JSON.stringify(value);
  });
  rebindPair(f); const service = f.service(); services.push(service);
  return {f, read: () => service.reader.getRunLatencyAttribution({id: f.query.id, scope: f.query.scope, attemptId: f.query.attemptId}, context())};
}
it('states a sustained merged p95 rise and names the request that holds most of the excess latency', async () => {
  const {read} = await archive(45, i => [i >= 25 && i < 35 ? 100 : 10, 20]);
  const result = await read(); expect(validateApi('RunLatencyAttribution', result).ok).toBe(true);
  expect(result).toMatchObject({generation: 1, manifestDigest: 'c'.repeat(64), windows: 45, reason: null,
    rise: {startTimeMs: T0 + 25000, endTimeMs: T0 + 35000, windows: 10, endpoint: {request: 'r0', share: 1}}});
  expect(result.rise!.baselineP95Ms).toBeCloseTo(20, -1); expect(result.rise!.peakP95Ms).toBeCloseTo(100, -1);
});
it('reports the rise without an endpoint when no single request holds more than half of the excess', async () => {
  const {read} = await archive(45, i => (i >= 25 && i < 35 ? [100, 100] : [10, 10]));
  expect((await read()).rise).toMatchObject({windows: 10, endpoint: null});
});
it('returns a fixed reason instead of a guess for short, flat or incompletely covered histories', async () => {
  expect(await (await archive(29, () => [10, 10])).read()).toMatchObject({windows: 29, rise: null, reason: 'too_few_windows'});
  expect(await (await archive(45, i => [i % 2 ? 12 : 10, 10])).read()).toMatchObject({rise: null, reason: 'no_rise'});
  const flat = await archive(45, () => [10, 10]);
  rewrite(flat.f, 'numeric-final', text => {const v = JSON.parse(text); v.metrics.windowCoverage = {complete: false, latePoints: 1, markerDelayDroppedBuckets: 0}; return JSON.stringify(v);});
  expect(await flat.read()).toMatchObject({rise: null, reason: 'incomplete_coverage'});
});
it('fails closed on a tampered data artifact and reports absent history as not recorded', async () => {
  const tampered = await archive(45, () => [10, 10]);
  rewrite(tampered.f, 'metric-windows', text => text.replace('"sequence":2', '"sequence":3'), false);
  await expect(tampered.read()).rejects.toMatchObject({code: 'unavailable'});
  const f = await fixture(); f.descriptors.splice(0, f.descriptors.length, ...f.descriptors.filter(a => a.kind === 'numeric-final'));
  const service = f.service(); services.push(service);
  expect(await service.reader.getRunLatencyAttribution({id: f.query.id, scope: f.query.scope, attemptId: f.query.attemptId}, context()))
    .toMatchObject({windows: 0, rise: null, reason: 'not_recorded'});
});
const point = (i: number, p95: number, endpoints: [string, number][] = [['r0', p95]]): RisePoint =>
  ({startTimeMs: T0 + i * 1000, endTimeMs: T0 + i * 1000 + 1000, count: 30, p95, endpoints: endpoints.map(([request, value]) => ({request, count: 30, p95: value}))});
it('breaks episodes at time gaps and under-sampled windows and never attributes a request without its own baseline', () => {
  const base = Array.from({length: 30}, (_, i) => point(i, 10));
  const gapped = [...base, ...[0, 1, 2, 4, 5, 6].map(k => point(30 + k, 50))];
  expect(riseOf(gapped)).toEqual({rise: null, reason: 'no_rise'});
  const thin = [...base, ...[0, 1, 2, 3, 4, 5].map(k => ({...point(30 + k, 50), count: k === 2 ? 19 : 30}))];
  expect(riseOf(thin).reason).toBe('no_rise');
  const fresh = [...base, ...[0, 1, 2, 3, 4].map(k => point(30 + k, 50, [['r0', 10], ['r9', 90]]))];
  expect(riseOf(fresh).rise).toMatchObject({windows: 5, baselineP95Ms: 10, peakP95Ms: 50, endpoint: null});
});
