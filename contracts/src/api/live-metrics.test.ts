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
