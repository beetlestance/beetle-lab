import type { MetricKind, MetricScope, MetricTags } from '../metrics/index.js';
export const measureStartedMetric = 'beetle_measure_started' as const;
export const counterNames = Object.freeze(['beetle_requests', 'beetle_assertions', 'beetle_assertion_failures',
  'beetle_required_failures', 'beetle_transport_failures', 'beetle_execution_failures', measureStartedMetric] as const);
export type CounterName = typeof counterNames[number];
export interface K6MetricShape {
  readonly requests: readonly {readonly id: string; readonly assertions: readonly {readonly id: string}[]}[];
  readonly readiness?: {readonly assertions: readonly {readonly id: string}[]};
}
declare const layoutBrand: unique symbol;
const layouts = new WeakSet<object>();
export interface K6MetricLayout {
  readonly [layoutBrand]: true;
  readonly requests: readonly {readonly id: string; readonly label: string;
    readonly assertions: readonly {readonly id: string; readonly label: string}[]}[];
  readonly readiness?: {readonly label: string; readonly assertions: readonly {readonly id: string; readonly label: string}[]};
  readonly labelSets: number;
}
export interface K6AllowedMetricSeries {readonly metric: string; readonly kind: MetricKind; readonly tags: MetricTags; readonly scope: MetricScope}
export class K6MetricPolicyError extends Error {
  constructor(readonly code: 'invalid_shape' | 'metric_limit') {super('K6 metric policy rejected'); this.name = 'K6MetricPolicyError';}
}
const trends = new Set(['http_req_duration', 'http_req_blocked', 'http_req_connecting',
  'http_req_tls_handshaking', 'http_req_sending', 'http_req_waiting', 'http_req_receiving', 'iteration_duration']);
const counters = new Set<string>([...counterNames.filter(name => name !== measureStartedMetric),
  'http_reqs', 'iterations', 'dropped_iterations', 'data_received', 'data_sent']);
const rates = new Set(['http_req_failed']);
const gauges = new Set(['vus', 'vus_max']);
export type { MetricKind } from '../metrics/index.js';
export interface NativeMetricDefinition { readonly name: string; readonly kind: MetricKind }
/** One immutable catalogue for owned native projection and wrapper admission. */
export const metricDefinitions: readonly NativeMetricDefinition[] = Object.freeze([
  ...[...trends].map(name => Object.freeze({ name, kind: 'trend' as const })),
  ...[...new Set([...counters, measureStartedMetric])].map(name => Object.freeze({ name, kind: 'counter' as const })),
  ...[...rates].map(name => Object.freeze({ name, kind: 'rate' as const })),
  ...[...gauges].map(name => Object.freeze({ name, kind: 'gauge' as const })),
]);

/** Input shape comes from validated configuration or the compiler; no thresholds/dataset work. */
export function k6MetricLayout(input: K6MetricShape): K6MetricLayout {
  if (!input || !Array.isArray(input.requests) || input.requests.length > 199) throw new K6MetricPolicyError('metric_limit');
  const allowance = 199 - input.requests.length - Number(input.readiness !== undefined); let assertion = 0;
  if (allowance < 0) throw new K6MetricPolicyError('metric_limit');
  const assertions = (items: readonly {readonly id: string}[]) => {
    if (!Array.isArray(items) || items.length > allowance - assertion) throw new K6MetricPolicyError('metric_limit');
    return Object.freeze(items.map(item => Object.freeze({id: id(item.id), label: `a${assertion++}`})));
  };
  const requests = Object.freeze(input.requests.map((request, index) => Object.freeze({id: id(request.id),
    label: `r${index}`, assertions: assertions(request.assertions)})));
  const readiness = input.readiness === undefined ? undefined
    : Object.freeze({label: `r${requests.length}`, assertions: assertions(input.readiness.assertions)});
  const layout = {requests, ...(readiness ? {readiness} : {}), labelSets: 1 + requests.length + assertion + Number(!!readiness)} as K6MetricLayout;
  layouts.add(layout); return Object.freeze(layout);
}
function id(value: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128) throw new K6MetricPolicyError('invalid_shape');
  return value;
}
const engine = new Set(['vus', 'vus_max', 'beetle_required_failures', 'beetle_execution_failures']);
const aggregate = new Set(['data_sent', 'data_received', 'beetle_transport_failures', 'beetle_execution_failures']);
export function k6MetricScope(name: string, tags: MetricTags = {}): MetricScope {
  if (name === measureStartedMetric) return 'control';
  if (tags.phase === 'prepare') return 'prepare';
  return engine.has(name) ? 'engine' : 'execute';
}
function seriesTags(name: string, layout: K6MetricLayout): readonly MetricTags[] {
  if ([measureStartedMetric, 'vus', 'vus_max', 'dropped_iterations'].includes(name)) return [{}];
  if (aggregate.has(name)) return [{phase: 'prepare'}, {phase: 'execute'}];
  if (['iterations', 'iteration_duration', 'beetle_required_failures'].includes(name)) return [{phase: 'execute'}];
  const requests = [...layout.requests.map(item => ({...item, phase: 'execute' as const})),
    ...(layout.readiness ? [{...layout.readiness, phase: 'prepare' as const}] : [])];
  if (name === 'beetle_assertions' || name === 'beetle_assertion_failures') {
    return requests.flatMap(request => request.assertions.map(assertion => ({phase: request.phase, assertion: assertion.label})));
  }
  return requests.map(request => ({phase: request.phase, request: request.label}));
}
export function k6MetricCatalogue(layout: K6MetricLayout): readonly K6AllowedMetricSeries[] {
  if (!layouts.has(layout)) throw new K6MetricPolicyError('invalid_shape');
  if (!Number.isSafeInteger(layout.labelSets) || layout.labelSets < 1 || layout.labelSets > 200) throw new K6MetricPolicyError('metric_limit');
  const result = metricDefinitions.flatMap(({name, kind}) => seriesTags(name, layout)
    .map(tags => Object.freeze({metric: name, kind, tags: Object.freeze(tags), scope: k6MetricScope(name, tags)})));
  if (result.length > 4600) throw new K6MetricPolicyError('metric_limit');
  return Object.freeze(result);
}
