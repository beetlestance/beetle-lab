import type { EngineResult } from '@beetle/contracts';
import type { PlanRule } from '../live/plan.js';
import { ruleName } from '../live/model.js';
import { ruleUnit, ruleValue } from '../live/rule-units.js';

const operators = { '<': 'under', '<=': 'at most', '>': 'over', '>=': 'at least' } as const;
/** Only SLO verdicts describe pass/fail; discovery comparisons have inverted native semantics. */
export function thresholdSentence(
  result: { readonly thresholds: readonly EngineResult['thresholds'][number][] } | null,
  rules: readonly PlanRule[] = [],
): string | null {
  const slos = result?.thresholds.filter((threshold) => threshold.purpose === 'slo') ?? [];
  if (slos.length === 0) return null;
  const failed = slos.filter((threshold) => !threshold.passed);
  if (failed.length === 0)
    return result?.thresholds.some((threshold) => threshold.purpose === 'discovery')
      ? 'Every SLO threshold passed.'
      : 'Every threshold passed.';
  if (failed.length === 1) return failedSentence(failed[0]!, rules);
  const names = failed.slice(0, 3).map((threshold) => threshold.id);
  return `${failed.length} thresholds failed: ${names.join(', ')}${failed.length > 3 ? '…' : ''}.`;
}
function failedSentence(threshold: EngineResult['thresholds'][number], rules: readonly PlanRule[]): string {
  const matches = rules.filter((rule) => rule.id === threshold.id);
  const rule = matches.length === 1 ? matches[0] : undefined;
  const reading = threshold.reading;
  if (!rule || !reading || reading.metric !== rule.metric || reading.stat !== rule.stat)
    return `Threshold ${threshold.id} failed.`;
  const unit = ruleUnit(rule);
  return `${ruleName(rule)} failed: ${ruleValue(unit, reading.value)}; limit ${operators[rule.operator]} ${ruleValue(unit, rule.value)}.`;
}
