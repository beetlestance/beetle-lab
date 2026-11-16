import { metricEvidenceLayout } from '../../plan/index.js';
import type { MetricKind } from '../../plan/index.js';
import { SummaryError } from './types.js';
import type { MetricEvidence, SummaryOptions } from './types.js';

const stats: Record<MetricKind, readonly string[]> = {
  counter: ['count', 'rate'], rate: ['rate', 'passes', 'fails'], gauge: ['value', 'min', 'max'],
  trend: ['count', 'avg', 'min', 'max', 'med', 'p(50)', 'p(90)', 'p(95)', 'p(99)'],
};
function invalid(): never { throw new SummaryError('invalid'); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) invalid();
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(value);
  if (actual.length !== expected.length || actual.some(key => !expected.includes(key))) invalid();
}
function values(input: unknown, kind: MetricKind): Readonly<Record<string, number>> {
  const raw = object(input);
  const result: Record<string, number> = Object.create(null) as Record<string, number>;
  for (const [key, value] of Object.entries(raw)) {
    result[key] = numericStat(key, value, kind);
  }
  ordering(result);
  return Object.freeze(result);
}
function numericStat(key: string, value: unknown, kind: MetricKind): number {
  if (!stats[kind].includes(key) || typeof value !== 'number' || !Number.isFinite(value) || value < 0) invalid();
  if (['count', 'passes', 'fails'].includes(key) && !Number.isSafeInteger(value)) invalid();
  if (kind === 'rate' && key === 'rate' && value > 1) invalid();
  return value;
}
function ordering(value: Readonly<Record<string, number>>): void {
  equivalentMedian(value);
  const ordered = ['min', 'p(50)', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'];
  let previous = -Infinity;
  for (const key of ordered) {
    const number = value[key];
    if (number === undefined) continue;
    if (number < previous) invalid();
    previous = number;
  }
  for (const key of ['avg', 'value']) {
    const number = value[key];
    if (number === undefined) continue;
    if (value.min !== undefined && number < value.min) invalid();
    if (value.max !== undefined && number > value.max) invalid();
  }
}
function equivalentMedian(value: Readonly<Record<string, number>>): void {
  if (value.med !== undefined && value['p(50)'] !== undefined && value.med !== value['p(50)']) invalid();
}
function verdicts(input: unknown, expressions: readonly string[]): MetricEvidence['thresholds'] {
  if (!Array.isArray(input) || input.length !== expressions.length) invalid();
  return Object.freeze(expressions.map((expression, index) => {
    const item = object(input[index]); keys(item, ['expression', 'ok']);
    if (item.expression !== expression || !(item.ok === null || typeof item.ok === 'boolean')) invalid();
    return Object.freeze({ expression, ok: item.ok });
  }));
}
function timing(input: unknown): Readonly<{ testRunDurationMs: number | null }> {
  const raw = object(input); keys(raw, ['testRunDurationMs']);
  const duration = raw.testRunDurationMs;
  if (duration !== null && (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0)) invalid();
  return Object.freeze({ testRunDurationMs: duration as number | null });
}
export function validateSummary(input: unknown, suite: SummaryOptions['compiledSuite']): {
  readonly metrics: Readonly<Record<string, MetricEvidence>>;
  readonly timing: Readonly<{ testRunDurationMs: number | null }>;
} {
  const layout = metricEvidenceLayout(suite);
  const root = object(input); keys(root, ['version', 'timing', 'metrics']);
  if (root.version !== 2) invalid();
  const nativeTiming = timing(root.timing);
  const metrics = object(root.metrics); keys(metrics, layout.metrics.map(item => item.key));
  const result: Record<string, MetricEvidence> = Object.create(null) as Record<string, MetricEvidence>;
  for (const entry of layout.metrics) {
    const metric = object(metrics[entry.key]); keys(metric, ['nativeKey', 'scope', 'provenance', 'values', 'thresholds']);
    if (metric.nativeKey !== entry.nativeKey || metric.scope !== entry.scope) invalid();
    const provenance = object(metric.provenance); keys(provenance, ['source', 'counterRateDenominator', 'rateDenominator']);
    for (const key of Object.keys(provenance)) {
      if (provenance[key] !== entry.provenance[key as keyof typeof entry.provenance]) invalid();
    }
    const numeric = values(metric.values, entry.kind);
    result[entry.key] = Object.freeze({ kind: entry.kind, nativeKey: entry.nativeKey,
      scope: entry.scope, provenance: entry.provenance, values: numeric,
      missingStats: Object.freeze(stats[entry.kind].filter(stat => numeric[stat] === undefined)),
      thresholds: verdicts(metric.thresholds, entry.thresholds.map(rule => rule.threshold)) });
  }
  return Object.freeze({ metrics: Object.freeze(result), timing: nativeTiming });
}
