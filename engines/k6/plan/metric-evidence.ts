import { counterNames, measureStartedMetric, metricDefinitions, metricLayout } from './metrics.js';
import type { MetricKind } from './metrics.js';
import type { CompiledSuite, DeepReadonly } from './suite.js';
import type { K6Threshold } from './load.js';

export type MetricScope = 'prepare' | 'execute' | 'engine' | 'control';
export interface MetricTags { readonly phase?: 'prepare' | 'execute'; readonly request?: string; readonly assertion?: string }
export interface AllowedMetricSeries { readonly metric: string; readonly kind: MetricKind; readonly tags: MetricTags; readonly scope: MetricScope }
export interface MetricProvenance {
  readonly source: 'native';
  readonly counterRateDenominator: 'engine-duration' | null;
  readonly rateDenominator: 'samples' | null;
}
export interface EvidenceMetric {
  readonly key: string; readonly nativeKey: string; readonly kind: MetricKind; readonly scope: MetricScope;
  readonly provenance: MetricProvenance; readonly thresholds: readonly K6Threshold[];
}
const engine = new Set(['vus', 'vus_max', 'beetle_required_failures', 'beetle_execution_failures']);
const aggregate = new Set(['data_sent', 'data_received', 'beetle_transport_failures', 'beetle_execution_failures']);
/** Native criterion spelling is phase first, then the one assigned label. */
export function nativeMetricKey(metric: string, tags: MetricTags): string {
  const criteria = Object.entries(tags).filter(([, value]) => value !== undefined);
  criteria.sort(([left], [right]) => (left === 'phase' ? -1 : right === 'phase' ? 1 : left.localeCompare(right)));
  return criteria.length ? metric + '{' + criteria.map(([key, value]) => `${key}:${value}`).join(',') + '}' : metric;
}
export function metricSeriesKey(metric: string, tags: MetricTags): string {
  return `${metric}:${tags.phase ?? ''}:${tags.request ?? ''}:${tags.assertion ?? ''}`;
}
function seriesTags(name: string, layout: ReturnType<typeof metricLayout>): readonly MetricTags[] {
  if ([measureStartedMetric, 'vus', 'vus_max', 'dropped_iterations'].includes(name)) return [{}];
  if (aggregate.has(name)) return [{ phase: 'prepare' }, { phase: 'execute' }];
  if (['iterations', 'iteration_duration', 'beetle_required_failures'].includes(name)) return [{ phase: 'execute' }];
  const requests = [...layout.requests.map(item => ({ ...item, phase: 'execute' as const })),
    ...(layout.readiness ? [{ ...layout.readiness, phase: 'prepare' as const }] : [])];
  if (name === 'beetle_assertions' || name === 'beetle_assertion_failures') {
    return requests.flatMap(request => request.assertions.map(assertion => ({ phase: request.phase, assertion: assertion.label })));
  }
  return requests.map(request => ({ phase: request.phase, request: request.label }));
}
function metricScope(name: string, tags: MetricTags = {}): MetricScope {
  if (name === measureStartedMetric) return 'control';
  if (tags.phase === 'prepare') return 'prepare';
  return engine.has(name) ? 'engine' : 'execute';
}
function series(suite: DeepReadonly<CompiledSuite>): readonly AllowedMetricSeries[] {
  const layout = metricLayout(suite);
  const result = metricDefinitions.flatMap(({ name, kind }) => seriesTags(name, layout)
    .map(tags => Object.freeze({ metric: name, kind, tags: Object.freeze(tags), scope: metricScope(name, tags) })));
  if (result.length > 4600) throw new Error('metric_limit');
  return Object.freeze(result);
}
function projectionRules(input: { suite: DeepReadonly<CompiledSuite>; name: string; tags: MetricTags;
  scoped: MetricTags; kind: MetricKind }): readonly K6Threshold[] {
  const { suite, name, tags, scoped, kind } = input;
  const rules = Object.keys(tags).length ? [] : (suite.loadPlan.options.thresholds[name] ?? []).map(rule => ({ ...rule }));
  if (counterNames.includes(name as typeof counterNames[number]) || Object.keys(scoped).length) {
    rules.push({ threshold: kind === 'rate' ? 'rate>=0' : 'count>=0', abortOnFail: false });
  }
  if (['beetle_required_failures', 'beetle_execution_failures'].includes(name)) rules.push({ threshold: 'count==0', abortOnFail: false });
  return Object.freeze(rules.map(rule => Object.freeze(rule)));
}
function projectionMetric(suite: DeepReadonly<CompiledSuite>, name: string, tags: MetricTags = {}): EvidenceMetric {
  const definition = metricDefinitions.find(item => item.name === name)!;
  const scope = metricScope(name);
  const scoped = scope === 'execute' && name !== 'dropped_iterations' ? { phase: 'execute' as const, ...tags } : tags;
  return Object.freeze({ key: nativeMetricKey(name, tags), nativeKey: nativeMetricKey(name, scoped),
    kind: definition.kind, scope, provenance: Object.freeze({ source: 'native',
      counterRateDenominator: definition.kind === 'counter' ? 'engine-duration' : null,
      rateDenominator: definition.kind === 'rate' ? 'samples' : null }),
    thresholds: projectionRules({ suite, name, tags, scoped, kind: definition.kind }) });
}
function projection(suite: DeepReadonly<CompiledSuite>): EvidenceMetric[] {
  const result = metricDefinitions.map(item => projectionMetric(suite, item.name));
  for (const request of metricLayout(suite).requests) {
    result.push(projectionMetric(suite, 'beetle_requests', { request: request.label }));
    for (const assertion of request.assertions) {
      result.push(projectionMetric(suite, 'beetle_assertions', { assertion: assertion.label }));
      result.push(projectionMetric(suite, 'beetle_assertion_failures', { assertion: assertion.label }));
    }
  }
  return result;
}
/** Pure shared owner for native submetrics, projection provenance and exact point admission. */
export function metricEvidenceLayout(suite: DeepReadonly<CompiledSuite>): {
  readonly series: readonly AllowedMetricSeries[]; readonly metrics: readonly EvidenceMetric[];
  readonly thresholds: Readonly<Record<string, readonly K6Threshold[]>>;
} {
  const metrics = Object.freeze(projection(suite));
  const thresholds: Record<string, readonly K6Threshold[]> = Object.create(null) as Record<string, readonly K6Threshold[]>;
  for (const metric of metrics) if (metric.thresholds.length) thresholds[metric.nativeKey] = metric.thresholds;
  return Object.freeze({ series: series(suite), metrics, thresholds: Object.freeze(thresholds) });
}
