import { createHash } from 'node:crypto';
import { DurationHistogram, projectMetricSeries } from '../metrics/index.js';
import { expect, it } from 'vitest';
import { captureLiveMetricSnapshot, captureLiveMetricSubset, decodeLiveMetricSnapshot, encodeLiveMetricSnapshot,
  liveMetricScopeMatches, liveMetricSubsetText } from './live-metrics.js';
import type { LiveMetricSnapshot, LiveMetricSubset } from './generated/types.js';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
function fixture(): LiveMetricSnapshot {
  const subset: LiveMetricSubset = { selected: [{ ordinal: 0, metric: 'beetle_requests', kind: 'counter', scope: 'execute', tags: {phase: 'execute', request: 'r0'} }], excludedSeries: 24 };
  return { version: 1, scope: { organizationId: '00000000-0000-4000-8000-000000000001', workspaceId: '00000000-0000-4000-8000-000000000002', attemptId: '00000000-0000-4000-8000-000000000003', generation: 1 },
    producerEpoch: '00000000-0000-4000-8000-000000000004', subsetDigest: hash(liveMetricSubsetText(subset)), subset,
    sourceSequence: 3, publishedSequence: 1, coalescedWindows: 2, capturedAtMs: 4000, publishedAtMs: 4100,
    startTimeMs: 2000, endTimeMs: 3000, upstreamCoverage: 'unknown', series: [{ ...subset.selected[0]!, unit: 'count', total: {kind: 'counter', sum: 7} }] };
}
it('round-trips a bounded sparse advisory window with explicit epoch, source scope and observed loss', () => {
  const f = fixture(); const bytes = encodeLiveMetricSnapshot(f, hash);
  expect(bytes.byteLength).toBeLessThanOrEqual(65536); expect(decodeLiveMetricSnapshot(bytes, hash)).toEqual(f);
  f.series = []; expect(captureLiveMetricSnapshot(f, hash).series).toEqual([]);
  expect(liveMetricScopeMatches(f.scope, {...f.scope})).toBe(true);
  expect(liveMetricScopeMatches(f.scope, {...f.scope, generation: 2})).toBe(false);
});
it('captures detached subset and frame state without invoking accessors', () => {
  const f = fixture(); const captured = captureLiveMetricSnapshot(f, hash);
  f.subset.selected[0]!.tags.request = 'r1'; expect(captured.subset.selected[0]!.tags.request).toBe('r0');
  let invoked = false; const input = { get selected() {invoked = true; return [];}, excludedSeries: 0 };
  expect(() => captureLiveMetricSubset(input)).toThrow(); expect(invoked).toBe(false);
});
it.each(['count', 'ordinal', 'duplicate', 'prepare', 'extra'] as const)('rejects malformed frozen subset: %s', kind => {
  const s = fixture().subset;
  if (kind === 'count') s.selected = Array.from({length: 21}, () => s.selected[0]!);
  if (kind === 'ordinal') s.selected[0]!.ordinal = 1;
  if (kind === 'duplicate') s.selected.push({...s.selected[0]!, ordinal: 1});
  if (kind === 'prepare') s.selected[0]!.tags.phase = 'prepare';
  const input = kind === 'extra' ? {...s, path: '/untrusted'} : s;
  expect(() => captureLiveMetricSubset(input)).toThrow(expect.objectContaining({code: 'invalid_subset'}));
});
it.each(['loss', 'sequence', 'window', 'clock', 'digest', 'unknown'] as const)('rejects invalid frame semantics: %s', kind => {
  const f = fixture();
  if (kind === 'loss') f.coalescedWindows = 1;
  if (kind === 'sequence') f.publishedSequence = 4;
  if (kind === 'window') f.endTimeMs++;
  if (kind === 'clock') f.publishedAtMs = 1;
  if (kind === 'digest') f.subsetDigest = 'f'.repeat(64);
  const input = kind === 'unknown' ? {...f, filename: 'foreign'} : f;
  expect(() => captureLiveMetricSnapshot(input, hash)).toThrow(expect.objectContaining({code: 'invalid_snapshot'}));
});
it('rejects malformed UTF8, oversized input, invalid JSON and failing digest capabilities', () => {
  for (const bytes of [new Uint8Array([255]), new Uint8Array(65537), new TextEncoder().encode('{')]) {
    expect(() => decodeLiveMetricSnapshot(bytes, hash)).toThrow(expect.objectContaining({code: 'invalid_snapshot'}));
  }
  expect(() => captureLiveMetricSnapshot(fixture(), () => {throw new Error('PRIVATE');})).toThrow('Live metric data rejected');
});
it('validates selected gauge timestamps within the actual source window', () => {
  const f = fixture(); const selection = {ordinal: 0, metric: 'vus', kind: 'gauge' as const, scope: 'engine' as const, tags: {}};
  f.subset.selected = [selection]; f.subsetDigest = hash(liveMetricSubsetText(f.subset));
  f.series = [{...selection, unit: 'count', total: {kind: 'gauge', latest: 1, min: 0, max: 2, sourceTimeMs: 2999}}];
  expect(captureLiveMetricSnapshot(f, hash).series).toHaveLength(1);
  f.series[0]!.total = {kind: 'gauge', latest: 1, min: 0, max: 2, sourceTimeMs: 3000};
  expect(() => captureLiveMetricSnapshot(f, hash)).toThrow();
});

it('keeps a zero-sample rate unknown and rejects invented ratios', () => {
  const f = fixture(); const selection = {...f.subset.selected[0]!, metric: 'http_req_failed', kind: 'rate' as const};
  f.subset.selected = [selection]; f.subsetDigest = hash(liveMetricSubsetText(f.subset));
  f.series = [{...selection, unit: 'ratio', total: {kind: 'rate', numerator: 0, sampleCount: 0, ratio: null}}];
  expect(captureLiveMetricSnapshot(f, hash).series[0]!.total).toMatchObject({ratio: null});
  f.series[0]!.total = {kind: 'rate', numerator: 0, sampleCount: 0, ratio: 0};
  expect(() => captureLiveMetricSnapshot(f, hash)).toThrow();
});
it('uses the same histogram bounds as historical projection and rejects invalid estimates', () => {
  const f = fixture(); const histogram = new DurationHistogram(); histogram.record(2); histogram.record(4);
  const source = {metric: 'http_req_duration', kind: 'trend' as const, scope: 'execute' as const, tags: {phase: 'execute' as const, request: 'r0'},
    total: {kind: 'trend' as const, count: 2, sum: 6, min: 2, max: 4, mean: 3, distribution: histogram.snapshot()}};
  const row = projectMetricSeries(source, 0);
  f.subset.selected = [{ordinal: 0, metric: source.metric, kind: source.kind, scope: source.scope, tags: source.tags}];
  f.subsetDigest = hash(liveMetricSubsetText(f.subset)); f.series = [row];
  expect(captureLiveMetricSnapshot(f, hash).series).toEqual([row]);
  if (row.total.kind !== 'trend') throw new Error('Expected trend');
  row.total.percentiles = {...row.total.percentiles, p95: {...row.total.percentiles.p95, estimate: 5}};
  expect(() => captureLiveMetricSnapshot(f, hash)).toThrow();
});

it('bounds the declared complete subset catalogue', () => {
  const subset = fixture().subset; subset.excludedSeries = 4600;
  expect(() => captureLiveMetricSubset(subset)).toThrow(expect.objectContaining({code: 'invalid_subset'}));
});

it.each(['identity', 'duplicate', 'unit', 'kind'] as const)('rejects invalid selected series: %s', kind => {
  const f = fixture();
  if (kind === 'identity') f.series[0]!.tags = {...f.series[0]!.tags, request: 'r1'};
  if (kind === 'duplicate') f.series.push(f.series[0]!);
  if (kind === 'unit') f.series[0]!.unit = 'ms';
  if (kind === 'kind') f.series[0]!.kind = 'rate';
  expect(() => captureLiveMetricSnapshot(f, hash)).toThrow(expect.objectContaining({code: 'invalid_snapshot'}));
});

function targetFrame() {
  const values = {rss: 1, heapAlloc: null, heapInuse: null, usedHeapSize: 0, totalHeapSize: null, cpuPercent: 5, systemCpuPercent: null,
    'eventLoopDelay.mean': null, 'eventLoopDelay.p99': null, 'eventLoopDelay.max': null, activeHandles: null, goroutines: null};
  return {...fixture(), target: {scope: 'target-reported' as const, intervalMs: 1000, omittedSamples: 0, samples: [
    {observedAtMs: 3000, phase: 'before' as 'before' | 'during', status: 'ready' as 'ready' | 'unavailable', values: {...values}},
    {observedAtMs: 4100, phase: 'during' as 'before' | 'during', status: 'ready' as 'ready' | 'unavailable', values: {...values}}]}};
}
type TargetFrame = ReturnType<typeof targetFrame>;
it('round-trips bounded target readings and keeps explicit zero and null', () => {
  const f = targetFrame(); const captured = decodeLiveMetricSnapshot(encodeLiveMetricSnapshot(f, hash), hash);
  expect(captured.target).toEqual(f.target); expect(captured.target!.samples[0]!.values.usedHeapSize).toBe(0);
  expect(captured.target!.samples[0]!.values.heapAlloc).toBeNull();
});
it.each([
  ['a future sample', (f: TargetFrame) => {f.target.samples[1]!.observedAtMs = 4101;}],
  ['a sample beyond the lookback', (f: TargetFrame) => {f.target.samples[0]!.observedAtMs = 4100 - (8 * 1000 + 5000) - 1;}],
  ['non-ascending samples', (f: TargetFrame) => {f.target.samples[1]!.observedAtMs = 3000;}],
  ['before after during', (f: TargetFrame) => {f.target.samples[0]!.phase = 'during'; f.target.samples[1]!.phase = 'before';}],
  ['an unavailable sample with a value', (f: TargetFrame) => {f.target.samples[1]!.status = 'unavailable';}],
  ['more than eight samples', (f: TargetFrame) => {f.target.samples = Array.from({length: 9}, (_, i) => ({...f.target.samples[1]!, observedAtMs: 4000 + i}));}],
  ['an unknown reading', (f: TargetFrame) => {Object.assign(f.target.samples[0]!.values, {secret: 1});}],
  ['a negative reading', (f: TargetFrame) => {Object.assign(f.target.samples[0]!.values, {rss: -1});}],
  ['an interval out of range', (f: TargetFrame) => {f.target.intervalMs = 999;}],
])('rejects target readings with %s', (_name, mutate) => {
  const f = targetFrame(); mutate(f);
  expect(() => captureLiveMetricSnapshot(f, hash)).toThrow(expect.objectContaining({code: 'invalid_snapshot'}));
});

function prefix(value=fixture()): NonNullable<LiveMetricSnapshot['archivePrefix']> {
 return {scope:value.scope,windows:3,endTimeMs:value.endTimeMs,
 data:{artifactId:'00000000-0000-4000-8000-000000000005',relativePath:'metric-windows.ndjson',bytes:2048,sha256:'a'.repeat(64)},
 index:{artifactId:'00000000-0000-4000-8000-000000000006',relativePath:'metric-index.ndjson',bytes:1024,sha256:'b'.repeat(64)}};
}
it('round-trips optional completed prefix evidence without changing the frame bound',()=>{
 const f=fixture();f.archivePrefix=prefix(f);const captured=decodeLiveMetricSnapshot(encodeLiveMetricSnapshot(f,hash),hash);
 expect(captured.archivePrefix).toEqual(f.archivePrefix);f.archivePrefix.data.bytes=9000;expect(captured.archivePrefix?.data.bytes).toBe(2048);
});
it.each(['scope','ids','bytes','count','end','future','path','hash'] as const)('refuses an invalid archive %s',kind=>{
 const f=fixture();f.archivePrefix=prefix(f);const p=f.archivePrefix;
 if(kind==='scope')p.scope={...p.scope,generation:2};if(kind==='ids')p.index.artifactId=p.data.artifactId;
 if(kind==='bytes'){p.data.bytes=268435456;p.index.bytes=1;}if(kind==='count')p.windows=2;
 if(kind==='end')p.endTimeMs=f.endTimeMs-1;if(kind==='future')p.endTimeMs=f.publishedAtMs+1;
 if(kind==='path')Object.assign(p.data,{relativePath:'../metric-windows.ndjson'});if(kind==='hash')p.data.sha256='x'.repeat(64);
 expect(()=>captureLiveMetricSnapshot(f,hash)).toThrow(expect.objectContaining({code:'invalid_snapshot'}));
});

function withTargetPrefix() {
 const value=fixture();value.archivePrefix=prefix(value);
 value.archivePrefix.target={scope:value.scope,samples:2,intervalMs:1000,
  data:{artifactId:'00000000-0000-4000-8000-000000000007',relativePath:'target-samples.ndjson',bytes:2048,sha256:'c'.repeat(64)}};
 return value;
}
it('captures a bounded target prefix in the existing metric archive envelope',()=>{
 const value=withTargetPrefix();const captured=decodeLiveMetricSnapshot(encodeLiveMetricSnapshot(value,hash),hash);
 expect(captured.archivePrefix?.target).toEqual(value.archivePrefix!.target);
 value.archivePrefix!.target!.data.bytes=9000;
 expect(captured.archivePrefix!.target!.data.bytes).toBe(2048);
 expect(encodeLiveMetricSnapshot(captured,hash).byteLength).toBeLessThanOrEqual(65536);
});
it.each(['scope','ids','count','bytes','interval','path','hash'] as const)('refuses target archive %s outside the fixed contract',kind=>{
 const value=withTargetPrefix();const target=value.archivePrefix!.target!;
 if(kind==='scope')target.scope={...target.scope,generation:2};
 if(kind==='ids')target.data.artifactId=value.archivePrefix!.data.artifactId;
 if(kind==='count')target.samples=257;if(kind==='bytes')target.data.bytes=1048577;
 if(kind==='interval')target.intervalMs=999;if(kind==='path')Object.assign(target.data,{relativePath:'../target-samples.ndjson'});
 if(kind==='hash')target.data.sha256='x'.repeat(64);
 expect(()=>captureLiveMetricSnapshot(value,hash)).toThrow(expect.objectContaining({code:'invalid_snapshot'}));
});
it('refuses a target hint whose interval contradicts the carried target readings',()=>{
 const value=targetFrame();value.archivePrefix=prefix(value);
 value.archivePrefix.target=withTargetPrefix().archivePrefix!.target!;
 value.archivePrefix.target.intervalMs=value.target!.intervalMs===1000?2000:1000;
 expect(()=>captureLiveMetricSnapshot(value,hash)).toThrow(expect.objectContaining({code:'invalid_snapshot'}));
});
