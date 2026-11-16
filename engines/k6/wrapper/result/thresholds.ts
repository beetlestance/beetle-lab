import { metricEvidenceLayout } from '../../plan/index.js';
import type { EvidenceMetric } from '../../plan/index.js';
import type { K6ResultInput, ThresholdEvidence } from './types.js';
import { countStat, counter, sum, verdict } from './numeric.js';

function support(input: K6ResultInput, metric: EvidenceMetric, expression: string): boolean {
  // Compiled metadata already owns native spelling. This prefix is only a lookup,
  // never a second formatter, threshold parser or numeric rule evaluator.
  const aggregation = expression.split(/[<>=!]/, 1)[0]!;
  const value = input.summary?.metrics[metric.key]?.values[aggregation];
  if (value === undefined) return false;
  if (!Number.isFinite(value) || value < 0) throw new Error('invalid_input');
  return sampled(input, metric);
}
function sampled(input: K6ResultInput, metric: EvidenceMetric): boolean {
  switch (metric.kind) {
    case 'counter': return counter(input.summary, metric.key) !== null;
    case 'trend': return (counter(input.summary, metric.key) ?? 0) > 0;
    case 'gauge': return input.summary?.metrics[metric.key]?.values.value !== undefined;
    case 'rate': {
      const passes = countStat(input.summary, metric.key, 'passes');
      const fails = countStat(input.summary, metric.key, 'fails');
      return passes !== null && fails !== null && sum(passes, fails) > 0;
    }
  }
}

export function thresholdEvidence(input: K6ResultInput): ThresholdEvidence {
  const layout = metricEvidenceLayout(input.suite);
  const verdicts: ThresholdEvidence['verdicts'] = [];
  let complete = true;
  for (const rule of input.suite.loadPlan.thresholds) {
    const metric = layout.metrics.find(item => item.key === rule.rule.metric);
    const passed = metric && support(input, metric, rule.threshold) ? verdict(input.summary, metric.key, rule.threshold) : null;
    if (passed === null) complete = false;
    else verdicts.push({ id: rule.id, purpose: rule.kind, passed });
  }
  const discovery = input.suite.loadPlan.thresholds.filter(rule => rule.kind === 'discovery');
  const reached = discovery.find(rule => verdicts.some(item => item.id === rule.id && item.purpose === 'discovery' && !item.passed));
  const selected = reached ?? discovery[0];
  return { verdicts, complete, sloFailed: verdicts.some(item => item.purpose === 'slo' && !item.passed),
    expectedAbort: selected ? { ruleId: selected.id, reached: reached !== undefined } : null };
}
