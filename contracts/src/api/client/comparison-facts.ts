import { encodeCanonicalJson } from '../../json.js';
import type { RunComparisonItem } from '../generated/types.js';
type Field = RunComparisonItem['differences']['fields'][number];
type Warning = RunComparisonItem['warnings'][number];
const fields: readonly [Field, (item: RunComparisonItem) => unknown][] = [
  ['revision', item => item.run.revisionDigest], ['engine', item => item.run.engine], ['budget', item => item.run.budget],
  ['execution_policy', item => item.run.executionPolicy], ['target', item => item.environment.targetDigest],
  ['inputs', item => item.environment.inputsDigest], ['secret_bindings', item => item.environment.secretBindingsDigest],
  ['settings', item => item.run.settingsVersions],
];
/** Differences are declared evidence, not a statistical compatibility verdict. */
export function comparisonFields(baseline: RunComparisonItem, item: RunComparisonItem): Field[] {
  return fields.filter(([, select]) => encodeCanonicalJson(select(baseline), 8192) !== encodeCanonicalJson(select(item), 8192)).map(([field]) => field);
}
/** One warning policy shared by the application and semantic response checker. */
export function comparisonWarnings(item: RunComparisonItem): Warning[] {
  const result: Warning[] = ['unknown_target_revision', 'unknown_contention'];
  if (item.environment.secretVersions === 'unknown') result.push('unknown_secret_version');
  if (item.environment.targetSampler === 'disabled') result.push('target_sampler_disabled');
  if (item.result === null) result.push('missing_result');
  else if (item.result.completeness !== 'complete') result.push('partial_result');
  if (item.differences.limited) result.push('limited_config_diff');
  if (!['ready', 'not_requested'].includes(item.metric.availability)) result.push('metric_unavailable');
  if (item.metric.coverage?.complete === false) result.push('partial_metric_windows');
  return result;
}
function successful(r: NonNullable<RunComparisonItem['result']>): boolean {
  return r.execution.status === 'completed' && r.completeness === 'complete'
    && r.requiredAssertions.failed === 0 && r.requiredAssertions.unknown === 0 && r.failedSloCount === 0;
}
export function comparisonResultMatches(item: RunComparisonItem): boolean {
  const r = item.result; if (!r) return item.run.outcome !== 'passed';
  if (item.run.outcome === 'passed' && r.outcome !== 'passed') return false;
  const a = r.requiredAssertions;
  if (!Number.isSafeInteger(a.passed + a.failed + a.unknown) || a.required !== a.passed + a.failed + a.unknown) return false;
  switch (r.outcome) {
    case 'passed': return successful(r);
    case 'failed': return r.execution.status === 'completed';
    default: return true;
  }
}
