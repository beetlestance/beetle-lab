import { k6MetricCatalogue, k6MetricLayout } from '@beetle/contracts/k6-metrics';
import type { K6MetricLayout } from '@beetle/contracts/k6-metrics';
import { metricSeriesIdentity } from '@beetle/contracts/metrics';
import type { RunComparisonBinding, RunMetricKey } from '@beetle/contracts/api';
import { ComparisonError } from '../../ports/run-comparison.js';
import type { ComparisonConfig } from './source.js';
function layout(config: ComparisonConfig): K6MetricLayout {
  try {return k6MetricLayout(config);} catch {throw new ComparisonError('unavailable');}
}
function accepted(key: RunMetricKey, value: K6MetricLayout): boolean {
  const identity = metricSeriesIdentity(key);
  return k6MetricCatalogue(value).some(series => metricSeriesIdentity(series) === identity);
}
/** Establish stable IDs only from the baseline's registered, bounded series layout. */
export function baselineBinding(config: ComparisonConfig, key: RunMetricKey): RunComparisonBinding {
  const value = layout(config); if (!accepted(key, value)) throw new ComparisonError('invalid_input');
  if (key.tags.request !== undefined) {
    const request = value.requests.find(item => item.label === key.tags.request);
    if (!request || value.requests.filter(item => item.id === request.id).length !== 1) throw new ComparisonError('invalid_input');
    return {requestId: request.id, assertionId: null};
  }
  if (key.tags.assertion !== undefined) return assertionBinding(value, key.tags.assertion);
  return {requestId: null, assertionId: null};
}
function assertionBinding(value: K6MetricLayout, label: string): RunComparisonBinding {
  const request = value.requests.find(item => item.assertions.some(assertion => assertion.label === label));
  const assertion = request?.assertions.find(item => item.label === label);
  if (!request || !assertion) throw new ComparisonError('invalid_input');
  if (value.requests.filter(item => item.id === request.id).length !== 1
    || request.assertions.filter(item => item.id === assertion.id).length !== 1) throw new ComparisonError('invalid_input');
  return {requestId: request.id, assertionId: assertion.id};
}
/** A missing logical input is distinct from an admitted series with no observed points. */
export function peerKey(config: ComparisonConfig, key: RunMetricKey, binding: RunComparisonBinding): RunMetricKey | null {
  if (binding.requestId === null) return key;
  const value = layout(config); const matches = value.requests.filter(item => item.id === binding.requestId);
  if (matches.length === 0) return null;
  if (matches.length !== 1) throw new ComparisonError('unavailable');
  const request = matches[0]!;
  if (binding.assertionId === null) return {...key, tags: {...key.tags, request: request.label}};
  const assertions = request.assertions.filter(item => item.id === binding.assertionId);
  if (assertions.length === 0) return null;
  if (assertions.length !== 1) throw new ComparisonError('unavailable');
  return {...key, tags: {...key.tags, assertion: assertions[0]!.label}};
}
