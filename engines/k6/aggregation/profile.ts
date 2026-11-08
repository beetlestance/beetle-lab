import { metricDefinitions, metricLayout, metricEvidenceLayout } from '../plan/index.js';
import type { AllowedMetricSeries, CompiledSuite, DeepReadonly } from '../plan/index.js';
import type { MetricDefinition } from './types.js';

export interface K6MetricProfile {
  readonly metrics: readonly MetricDefinition[];
  readonly requestLabels: readonly string[];
  readonly assertionLabels: readonly string[];
  readonly requests: readonly Readonly<{ id: string; label: string }>[];
  readonly assertions: readonly Readonly<{ id: string; label: string }>[];
  readonly readinessLabel?: string;
  readonly maximumSeries: number;
  readonly allowedSeries: readonly AllowedMetricSeries[];
}
const trusted = new WeakSet<K6MetricProfile>();
export function isK6MetricProfile(profile: K6MetricProfile): boolean { return trusted.has(profile); }

/** Snapshot the public compiler layout; native points never extend this catalogue. */
export function createK6MetricProfile(suite: DeepReadonly<CompiledSuite>): K6MetricProfile {
  const layout = metricLayout(suite);
  const evidence = metricEvidenceLayout(suite);
  const requests = layout.requests.map(({ id, label }) => Object.freeze({ id, label }));
  const assertions = layout.requests.flatMap(request => request.assertions);
  if (layout.readiness) assertions.push(...layout.readiness.assertions);
  const requestLabels = requests.map(request => request.label);
  if (layout.readiness) requestLabels.push(layout.readiness.label);
  const profile: K6MetricProfile = Object.freeze({
    metrics: Object.freeze(metricDefinitions.map(metric => Object.freeze({ ...metric }))),
    requests: Object.freeze(requests),
    assertions: Object.freeze(assertions.map(assertion => Object.freeze({ ...assertion }))),
    requestLabels: Object.freeze(requestLabels),
    assertionLabels: Object.freeze(assertions.map(assertion => assertion.label)),
    ...(layout.readiness ? { readinessLabel: layout.readiness.label } : {}),
    maximumSeries: evidence.series.length,
    allowedSeries: evidence.series,
  });
  trusted.add(profile);
  return profile;
}
