import { metricSeriesIdentity } from '@beetle/contracts/metrics';
import { encodeJson } from '@beetle/contracts';
import { validateApi } from '@beetle/contracts/api';
import type { RunComparisonMetricRead, RunMetricKey } from '@beetle/contracts/api';
import { ComparisonError } from '../../ports/run-comparison.js';
import type { RunMetricLookupReader, RunMetricLookupResult } from '../../ports/run-metrics.js';
import type { MetricReadOperation } from '../metric-read-lifetime/index.js';
import type { Source } from './source.js';
export function emptyMetric(availability: 'not_requested' | 'not_applicable' | 'unavailable', reason: RunComparisonMetricRead['reason'] = null): RunComparisonMetricRead {
  return {availability, reason, series: null, manifestDigest: null, measurementSourceTimeMs: null, coverage: null};
}
function envelope(input: RunMetricLookupResult): RunMetricLookupResult {
  let copy: RunMetricLookupResult;
  try {copy = JSON.parse(encodeJson(input, 16384)) as RunMetricLookupResult;} catch {throw new ComparisonError('unavailable');}
  if (!copy || Object.keys(copy).length !== 2 || !Object.hasOwn(copy, 'source') || !Object.hasOwn(copy, 'series')) throw new ComparisonError('unavailable');
  return copy;
}
function sourceIdentity(value: RunMetricLookupResult['source'], source: Source): boolean {
  return value.id === source.run.id && value.attemptId === source.run.activeAttemptId
    && value.scope.organizationId === source.run.scope.organizationId && value.scope.workspaceId === source.run.scope.workspaceId;
}
function capture(input: RunMetricLookupResult, source: Source, key: RunMetricKey): RunMetricLookupResult {
  const copy = envelope(input);
  const p = copy.source;
  if (!p || Object.hasOwn(p, 'items') || Object.hasOwn(p, 'nextCursor')) throw new ComparisonError('unavailable');
  const checked = validateApi('RunMetricSeriesPage', {...p, items: copy.series ? [copy.series] : [], nextCursor: null});
  if (!checked.ok || !sourceIdentity(p, source)) throw new ComparisonError('unavailable');
  if (copy.series && metricSeriesIdentity(copy.series) !== metricSeriesIdentity(key)) throw new ComparisonError('unavailable');
  return copy;
}
function projected(value: RunMetricLookupResult): RunComparisonMetricRead {
  const p = value.source;
  if (p.availability === 'ready') return {availability: value.series ? 'ready' : 'missing', reason: value.series ? null : 'not_observed',
    series: value.series, manifestDigest: p.manifestDigest, measurementSourceTimeMs: p.measurementSourceTimeMs, coverage: p.coverage};
  if (value.series !== null || p.coverage !== null || p.measurementSourceTimeMs !== null) throw new ComparisonError('unavailable');
  const reason = p.availability === 'absent' ? 'source_absent' : p.reason;
  if (reason === null) throw new ComparisonError('conflict');
  return {...emptyMetric('unavailable', reason), manifestDigest: p.manifestDigest};
}
export async function readMetric(source: Source, key: RunMetricKey | null, reader: RunMetricLookupReader, owner: MetricReadOperation): Promise<RunComparisonMetricRead> {
  if (source.result === null) return emptyMetric('unavailable', 'result_absent');
  if (key === null) return emptyMetric('not_applicable', 'logical_input_absent');
  owner.check(); const result = await reader.lookupRunMetricSeries({id: source.run.id, scope: source.run.scope,
    attemptId: source.run.activeAttemptId, metric: key}, owner); owner.check();
  return projected(capture(result, source, key));
}
