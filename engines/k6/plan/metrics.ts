import { fail } from './failure.js';
import type { CompiledSuite, DeepReadonly } from './suite.js';

export const measureStartedMetric = 'beetle_measure_started' as const;
export const counterNames = ['beetle_requests', 'beetle_assertions', 'beetle_assertion_failures',
  'beetle_required_failures', 'beetle_transport_failures', 'beetle_execution_failures', measureStartedMetric] as const;
export type CounterName = typeof counterNames[number];
export interface MetricLayout {
  requests: { id: string; label: string; assertions: { id: string; label: string }[] }[];
  readiness?: { label: string; assertions: { id: string; label: string }[] };
  labelSets: number;
}
const trends = new Set(['http_req_duration', 'http_req_blocked', 'http_req_connecting',
  'http_req_tls_handshaking', 'http_req_sending', 'http_req_waiting', 'http_req_receiving', 'iteration_duration']);
const counters = new Set<string>([...counterNames.filter(name => name !== measureStartedMetric),
  'http_reqs', 'iterations', 'dropped_iterations', 'data_received', 'data_sent']);
const rates = new Set(['http_req_failed']);
const gauges = new Set(['vus', 'vus_max']);
export type MetricKind = 'counter' | 'gauge' | 'rate' | 'trend';
export interface NativeMetricDefinition { readonly name: string; readonly kind: MetricKind }
/** One immutable catalogue for owned native projection and wrapper admission. */
export const metricDefinitions: readonly NativeMetricDefinition[] = Object.freeze([
  ...[...trends].map(name => Object.freeze({ name, kind: 'trend' as const })),
  ...[...new Set([...counters, measureStartedMetric])].map(name => Object.freeze({ name, kind: 'counter' as const })),
  ...[...rates].map(name => Object.freeze({ name, kind: 'rate' as const })),
  ...[...gauges].map(name => Object.freeze({ name, kind: 'gauge' as const })),
]);
const trendStats = new Set(['avg', 'min', 'max', 'med', 'p50', 'p90', 'p95', 'p99']);
function supported(metric: string, stat: string): boolean {
  if (trends.has(metric)) return trendStats.has(stat);
  if (counters.has(metric)) return stat === 'count' || stat === 'rate';
  if (rates.has(metric)) return stat === 'rate';
  return gauges.has(metric) && stat === 'value';
}
/** Compiler label budget: aggregate plus assigned request/assertion maps; phase never multiplies it. */
export function metricLayout(suite: DeepReadonly<CompiledSuite>): MetricLayout {
  let assertion = 0;
  const assertions = (items: readonly { readonly id: string }[]): { id: string; label: string }[] =>
    items.map(item => ({ id: item.id, label: `a${assertion++}` }));
  const requests = suite.requests.map((request, index) => ({ id: request.id, label: `r${index}`,
    assertions: assertions(request.assertions) }));
  const layout: MetricLayout = { requests, labelSets: 1 + requests.length };
  if (suite.readiness) layout.readiness = { label: `r${requests.length}`, assertions: assertions(suite.readiness.assertions) };
  layout.labelSets += assertion + (layout.readiness ? 1 : 0);
  if (layout.labelSets > 200) fail('metric_limit');
  for (const { rule } of suite.loadPlan.thresholds) if (!supported(rule.metric, rule.stat)) fail('metric');
  return layout;
}
