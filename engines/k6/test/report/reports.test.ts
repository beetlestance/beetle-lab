import { expect, it } from 'vitest';
import { DurationHistogram, projectMetricValue } from '@beetle/contracts/metrics';
import { mapK6Result } from '../../wrapper/result/index.js';
import type { K6ResultBody } from '../../wrapper/result/index.js';
import { renderPerformanceReports } from '../../report/index.js';
import { ReportWriter, csvCell } from '../../report/writer.js';
import { fixture, discoveryConfig } from '../result/fixtures.js';
function setup() {
  const source = fixture(); const mapped = mapK6Result(source);
  if (!mapped.ok) throw new Error('Invalid report fixture');
  return {source, result: mapped.body};
}
const decode = (value: Uint8Array) => Buffer.from(value).toString('utf8');
it('preserves outcome, assertion-definition counts, exact zero and unknown metric absence', () => {
  const {source, result} = setup();
  source.metrics!.totals = [{metric: 'beetle_requests', kind: 'counter', scope: 'execute', tags: {phase: 'execute', request: 'r0'}, total: {kind: 'counter', sum: 0}}];
  const reports = renderPerformanceReports({result, metrics: source.metrics, maximumBytes: 262144});
  const text = decode(reports.text); const csv = decode(reports.csv);
  expect(text).toContain('Outcome: passed'); expect(text).toContain('Required assertion definitions: 2; passed=2; failed=0; unknown=0');
  expect(text).toContain('Observed metric series: 1. Missing series/statistics are unknown, not zero.');
  expect(text).toContain('beetle_requests{phase=execute,request=r0} [count]: sum=0');
  expect(csv.split('\n')).toHaveLength(4); expect(csv).toContain('"beetle_requests","counter","execute","execute","r0",,"count",0,');
  expect(text).not.toContain('https://'); expect(csv).not.toContain('SECRET');
});
it('uses the shared histogram estimates and includes every percentile bound and method', () => {
  const {source, result} = setup(); const histogram = new DurationHistogram(); histogram.record(3); histogram.record(9);
  const total = {kind: 'trend' as const, count: 2, sum: 12, min: 3, max: 9, mean: 6, distribution: {...histogram.snapshot(), buckets: [...histogram.snapshot().buckets]}};
  source.metrics!.totals = [{metric: 'http_req_duration', kind: 'trend', scope: 'execute', tags: {request: 'r0'}, total}];
  const text = decode(renderPerformanceReports({result, metrics: source.metrics, maximumBytes: 262144}).text);
  const value = projectMetricValue(total); if (value.kind !== 'trend') throw new Error('Bad projection');
  for (const key of ['p50', 'p90', 'p95', 'p99'] as const) {
    const estimate = value.percentiles[key];
    expect(text).toContain(`${key}=${estimate.estimate} ${key}Lower=${estimate.lower} ${key}Upper=${estimate.upper}`);
  }
  expect(text).toContain('percentileMethod=histogram-estimate');
});
it('keeps rate denominators, source-timed engine gauges and missing coverage distinct', () => {
  const {source, result} = setup();
  source.metrics!.windowCoverage = {complete: false, latePoints: 3, markerDelayDroppedBuckets: 1};
  source.metrics!.totals = [
    {metric: 'http_req_failed', kind: 'rate', scope: 'execute', tags: {}, total: {kind: 'rate', numerator: 0, sampleCount: 0}},
    {metric: 'vus', kind: 'gauge', scope: 'engine', tags: {}, total: {kind: 'gauge', latest: 2, min: 1, max: 5, sourceTimeMs: 1234}},
  ];
  const text = decode(renderPerformanceReports({result, metrics: source.metrics, maximumBytes: 262144}).text);
  expect(text).toContain('partial; latePoints=3; markerDelayDroppedBuckets=1');
  expect(text).toContain('numerator=0 sampleCount=0'); expect(text).not.toContain('ratio=0');
  expect(text).toContain('engine vus [count]: latest=2 sourceTimeMs=1234 min=1 max=5');
  const missing = decode(renderPerformanceReports({result, metrics: null, maximumBytes: 262144}).text);
  expect(missing).toContain('metric window coverage: missing'); expect(missing).toContain('Observed metric series: 0');
  const csv = decode(renderPerformanceReports({result, metrics: null, maximumBytes: 262144}).csv);
  expect(csv).toContain('"summary"'); expect(csv).toContain('"missing",0,');
  expect(new Set(csv.trimEnd().split('\n').map(line => line.split(',').length)).size).toBe(1);
});
it('presents discovery/threshold verdicts without treating inverse-rule failure as test failure', () => {
  const source = fixture(discoveryConfig());
  for (const metric of Object.values(source.summary!.metrics)) for (const rule of metric.thresholds) rule.ok = false;
  const mapped = mapK6Result(source); if (!mapped.ok) throw new Error('Invalid discovery fixture');
  const text = decode(renderPerformanceReports({result: mapped.body, metrics: source.metrics, maximumBytes: 262144}).text);
  expect(text).toContain(`Outcome: ${mapped.body.outcome}`); expect(text).toContain('Discovery rule stop: reached=true');
  expect(text).toContain('[discovery]: failed');
});
it('rejects malformed, duplicate, excessive and foreign-scope metrics without partial reports', () => {
  const {source, result} = setup();
  const row = {metric: 'requests', kind: 'counter' as const, scope: 'execute' as const, tags: {}, total: {kind: 'counter' as const, sum: 1}};
  for (const totals of [[row, row], Array<typeof row>(4601).fill(row), [{...row, scope: 'prepare' as const}],
    [{...row, total: {kind: 'counter' as const, sum: Infinity}}]]) {
    source.metrics!.totals = totals;
    expect(() => renderPerformanceReports({result, metrics: source.metrics, maximumBytes: 262144})).toThrowError(expect.objectContaining({code: 'invalid_input'}));
  }
  expect(() => renderPerformanceReports({result: {...result, outcome: 'secret_invalid'} as unknown as K6ResultBody,
    metrics: null, maximumBytes: 262144})).toThrowError(expect.objectContaining({code: 'invalid_input', message: 'Performance report rejected'}));
});
it('enforces exact independent byte caps, includes newline and fails rather than truncating', () => {
  const {source, result} = setup(); const base = {result, metrics: source.metrics};
  const output = renderPerformanceReports({...base, maximumBytes: 262144}); const maximumBytes = Math.max(output.text.length, output.csv.length);
  expect(renderPerformanceReports({...base, maximumBytes}).text).toEqual(output.text);
  expect(() => renderPerformanceReports({...base, maximumBytes: maximumBytes - 1})).toThrowError(expect.objectContaining({code: 'output_limit'}));
  for (const maximumBytes of [0, NaN, Infinity, 262145, 1.5]) expect(() => renderPerformanceReports({...base, maximumBytes})).toThrowError(expect.objectContaining({code: 'invalid_input'}));
  const writer = new ReportWriter(4); writer.line('€'); expect(writer.finish().length).toBe(4);
  expect(() => writer.line('')).toThrowError(expect.objectContaining({code: 'output_limit'}));
});
it('neutralizes formula cells, quotes separators and leaves numeric cells numeric', () => {
  for (const text of ['=cmd()', '+cmd()', '-cmd()', '@cmd()', '\tcmd()', '\rcmd()']) expect(csvCell(text)).toBe(`"'${text}"`);
  expect(csvCell('a,"b')).toBe('"a,""b"'); expect(csvCell(0)).toBe('0'); expect(csvCell(null)).toBe('');
});
