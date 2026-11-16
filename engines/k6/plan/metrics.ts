import { k6MetricLayout, measureStartedMetric, metricDefinitions } from '@beetle/contracts/k6-metrics';
import type { K6MetricLayout } from '@beetle/contracts/k6-metrics';
import { fail } from './failure.js';
import type { CompiledSuite, DeepReadonly } from './suite.js';
export { measureStartedMetric, counterNames, metricDefinitions } from '@beetle/contracts/k6-metrics';
export type { CounterName, NativeMetricDefinition } from '@beetle/contracts/k6-metrics';
export type { MetricKind } from '@beetle/contracts/metrics';
export type MetricLayout = K6MetricLayout;
const kinds = new Map(metricDefinitions.map(metric => [metric.name, metric.kind]));
const trendStats = new Set(['avg', 'min', 'max', 'med', 'p50', 'p90', 'p95', 'p99']);
function supported(metric: string, stat: string): boolean {
  if (metric === measureStartedMetric) return false;
  const kind = kinds.get(metric);
  if (kind === 'trend') return trendStats.has(stat);
  if (kind === 'counter') return stat === 'count' || stat === 'rate';
  if (kind === 'rate') return stat === 'rate';
  return kind === 'gauge' && stat === 'value';
}
/** Pure labels are shared; compiled threshold validation stays with the compiler. */
export function metricLayout(suite: DeepReadonly<CompiledSuite>): MetricLayout {
  let layout: MetricLayout;
  try {layout = k6MetricLayout(suite);} catch {fail('metric_limit');}
  for (const {rule} of suite.loadPlan.thresholds) if (!supported(rule.metric, rule.stat)) fail('metric');
  return layout;
}
