import { encodeCanonicalJson } from '../../json.js';
import type { RunMetricKey, RunComparisonBinding, RunComparisonMetricRead } from '../generated/types.js';
import { metricDescriptorMatches } from './metric-values.js';
export function comparisonKeyText(key: RunMetricKey | null): string {return encodeCanonicalJson(key, 2048);}
export function comparisonBindingMatches(key: RunMetricKey | null, binding: RunComparisonBinding | null): boolean {
  if (!key) return binding === null;
  if (!binding) return false;
  if (key.tags.assertion !== undefined) return binding.requestId !== null && binding.assertionId !== null;
  if (key.tags.request !== undefined) return binding.requestId !== null && binding.assertionId === null;
  return binding.requestId === null && binding.assertionId === null;
}
function empty(read: RunComparisonMetricRead): boolean {
  return read.series === null && read.measurementSourceTimeMs === null && read.coverage === null;
}
function source(read: RunComparisonMetricRead): boolean {
  return read.manifestDigest !== null && read.measurementSourceTimeMs !== null && read.coverage !== null;
}
function selected(read: RunComparisonMetricRead, key: RunMetricKey, baseline: boolean): boolean {
  const series = read.series;
  if (!series || !metricDescriptorMatches(series)) return false;
  if (series.metric !== key.metric || series.kind !== key.kind || series.scope !== key.scope) return false;
  const tags = series.tags;
  if (tags.phase !== key.tags.phase || (tags.request !== undefined) !== (key.tags.request !== undefined)
    || (tags.assertion !== undefined) !== (key.tags.assertion !== undefined)) return false;
  return !baseline || encodeCanonicalJson({metric: series.metric, kind: series.kind, scope: series.scope, tags}, 2048) === comparisonKeyText(key);
}
function unrequested(read: RunComparisonMetricRead): boolean {
  return read.availability === 'not_requested' && read.reason === null && read.manifestDigest === null && empty(read);
}
function missing(read: RunComparisonMetricRead): boolean {
  return read.reason === 'not_observed' && read.series === null && source(read);
}
function notApplicable(read: RunComparisonMetricRead, key: RunMetricKey, baseline: boolean): boolean {
  const labelled = Object.keys(key.tags).some(tag => tag === 'request' || tag === 'assertion');
  return !baseline && labelled && read.reason === 'logical_input_absent' && read.manifestDigest === null && empty(read);
}
function unavailable(read: RunComparisonMetricRead): boolean {
  return ['result_absent', 'not_recorded', 'unsupported_format', 'source_absent'].includes(read.reason ?? '') && empty(read);
}
export function comparisonMetricMatches(read: RunComparisonMetricRead, key: RunMetricKey | null, baseline: boolean): boolean {
  if (!key) return unrequested(read);
  switch (read.availability) {
    case 'ready': return read.reason === null && source(read) && selected(read, key, baseline);
    case 'missing': return missing(read);
    case 'not_applicable': return notApplicable(read, key, baseline);
    case 'unavailable': return unavailable(read);
    default: return false;
  }
}
