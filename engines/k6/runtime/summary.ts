import type { CompiledSuite, DeepReadonly } from '../plan/index.js';
import { BoundedText, quoted } from './bounds.js';
import { nativeThresholds } from './options.js';

const builtinMetrics = ['http_reqs', 'http_req_duration', 'http_req_blocked', 'http_req_connecting',
  'http_req_tls_handshaking', 'http_req_sending', 'http_req_waiting', 'http_req_receiving',
  'http_req_failed', 'iterations', 'iteration_duration', 'dropped_iterations', 'data_sent', 'data_received', 'vus', 'vus_max'];
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
  const thresholds = nativeThresholds(suite);
  const names = new Set([...builtinMetrics, ...Object.keys(thresholds)]);
  const metrics = property(data, 'metrics');
  output.append('{"version":1,"metrics":{');
  let separator = '';
  for (const name of names) {
    const metric = property(metrics, name);
    output.append(separator); quoted(output, name); output.append(':{"values":');
    values(output, metric); output.append(',"thresholds":');
    thresholdEvidence(output, metric, (thresholds[name] ?? []).map(rule => rule.threshold));
    output.append('}'); separator = ',';
  }
  output.append('}}\n');
  return output.finish();
}
