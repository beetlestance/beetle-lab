import { metricDefinitions, metricLayout } from '../../plan/index.js';
import type { MetricKind } from '../../plan/index.js';
import { nativeThresholds } from '../../runtime/index.js';
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
export function validateSummary(input: unknown, suite: SummaryOptions['compiledSuite']): Readonly<Record<string, MetricEvidence>> {
  // Public layout validates the compiled label profile used by nativeThresholds.
  metricLayout(suite);
  const thresholds = nativeThresholds(suite);
  const definitions = new Map(metricDefinitions.map(item => [item.name, item.kind]));
  const names = [...new Set([...definitions.keys(), ...Object.keys(thresholds)])];
  const root = object(input); keys(root, ['version', 'metrics']);
  if (root.version !== 1) invalid();
  const metrics = object(root.metrics); keys(metrics, names);
  const result: Record<string, MetricEvidence> = Object.create(null) as Record<string, MetricEvidence>;
  for (const name of names) {
    const kind = definitions.get(name) ?? definitions.get(name.split('{')[0]!);
    if (!kind) invalid();
    const metric = object(metrics[name]); keys(metric, ['values', 'thresholds']);
    const numeric = values(metric.values, kind);
    result[name] = Object.freeze({ kind, values: numeric,
      missingStats: Object.freeze(stats[kind].filter(stat => numeric[stat] === undefined)),
      thresholds: verdicts(metric.thresholds, (thresholds[name] ?? []).map(rule => rule.threshold)) });
  }
  return Object.freeze(result);
}
