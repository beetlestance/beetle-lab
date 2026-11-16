import type { CompiledSuite, DeepReadonly } from '../plan/index.js';
import { metricEvidenceLayout } from '../plan/index.js';
import { BoundedText, quoted } from './bounds.js';

const stats = ['count', 'rate', 'value', 'avg', 'min', 'max', 'med', 'p(50)', 'p(90)', 'p(95)', 'p(99)', 'passes', 'fails'];
function property(value: unknown, key: string): unknown {
  return value !== null && typeof value === 'object' && Object.hasOwn(value, key)
    ? (value as Record<string, unknown>)[key] : undefined;
}
function values(output: BoundedText, metric: unknown): void {
  output.append('{');
  let separator = '';
  const value = property(metric, 'values');
  for (const key of stats) {
    const number = property(value, key);
    if (typeof number !== 'number' || !Number.isFinite(number)) continue;
    output.append(separator); quoted(output, key); output.append(':' + String(number)); separator = ',';
  }
  output.append('}');
}
function thresholdEvidence(output: BoundedText, metric: unknown, expressions: readonly string[]): void {
  const thresholds = property(metric, 'thresholds');
  output.append('[');
  expressions.forEach((expression, index) => {
    if (index) output.append(',');
    const ok = property(property(thresholds, expression), 'ok');
    output.append('{"expression":'); quoted(output, expression);
    output.append(',"ok":' + (typeof ok === 'boolean' ? String(ok) : 'null') + '}');
  });
  output.append(']');
}
/** Numeric evidence only; never serialize the native root, groups, errors or arbitrary tags. */
export function summaryProjection(suite: DeepReadonly<CompiledSuite>, data: unknown): string {
  const output = new BoundedText(1_048_576);
  const layout = metricEvidenceLayout(suite);
  const duration = property(property(data, 'state'), 'testRunDurationMs');
  const timing = typeof duration === 'number' && Number.isFinite(duration) && duration >= 0 ? duration : null;
  const metrics = property(data, 'metrics');
  output.append('{"version":2,"timing":{"testRunDurationMs":' + String(timing) + '},"metrics":{');
  let separator = '';
  for (const entry of layout.metrics) {
    const metric = property(metrics, entry.nativeKey);
    output.append(separator); quoted(output, entry.key); output.append(':{"nativeKey":');
    quoted(output, entry.nativeKey); output.append(',"scope":'); quoted(output, entry.scope);
    output.append(',"provenance":' + JSON.stringify(entry.provenance) + ',"values":');
    values(output, metric); output.append(',"thresholds":');
    thresholdEvidence(output, metric, entry.thresholds.map(rule => rule.threshold));
    output.append('}'); separator = ',';
  }
  output.append('}}\n');
  return output.finish();
}
