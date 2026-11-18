import { metricDefinitions } from '@beetle/contracts/k6-metrics';
import type { PlanRule } from './plan.js';
export type RuleUnit = 'ms' | 'ratio' | 'count' | 'bytes' | 'count/s' | 'bytes/s' | null;
const kinds = new Map(metricDefinitions.map((metric) => [metric.name, metric.kind]));
const trendStats = new Set(['avg', 'min', 'max', 'med', 'p50', 'p90', 'p95', 'p99']);
/** Display dimensions only; this never validates a threshold or infers its verdict. */
export function ruleUnit(rule: Pick<PlanRule, 'metric' | 'stat'>): RuleUnit {
  if (rule.metric === 'checks' && rule.stat === 'rate') return 'ratio';
  const kind = kinds.get(rule.metric);
  if (kind === 'trend') return trendStats.has(rule.stat) ? 'ms' : null;
  if (kind === 'rate') return rule.stat === 'rate' ? 'ratio' : null;
  if (kind === 'gauge') return ['value', 'min', 'max'].includes(rule.stat) ? 'count' : null;
  if (kind === 'counter') return counterUnit(rule);
  return null;
}
function counterUnit(rule: Pick<PlanRule, 'metric' | 'stat'>): RuleUnit {
  const bytes = rule.metric === 'data_sent' || rule.metric === 'data_received';
  if (rule.stat === 'count') return bytes ? 'bytes' : 'count';
  if (rule.stat === 'rate') return bytes ? 'bytes/s' : 'count/s';
  return null;
}
function scalar(value: number) {
  return value !== 0 && Math.abs(value) < 0.000001
    ? value.toExponential(2)
    : value.toLocaleString('en-US', { maximumSignificantDigits: 15 });
}
/** Unknown metric dimensions remain explicit; small positive limits never round to zero. */
export function ruleValue(unit: RuleUnit, value: number): string {
  if (unit === 'ratio') return `${scalar(value * 100)}%`;
  if (unit === 'count') return scalar(value);
  if (unit === null) return `${scalar(value)} (unit unknown)`;
  return `${scalar(value)} ${unit}`;
}
