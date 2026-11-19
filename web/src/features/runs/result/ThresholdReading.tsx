import type { EngineResult } from '@beetle/contracts';
import { Status } from '../../../components/Badge.js';
import type { PlanRule } from '../live/plan.js';
import { ruleName } from '../live/model.js';
import { observedRuleValue, ruleUnit, ruleValue } from '../live/rule-units.js';
import './threshold.css';
type Threshold = EngineResult['thresholds'][number];
const operator = { '<': 'under', '<=': 'at most', '>': 'over', '>=': 'at least' } as const;
function status(threshold: Threshold) {
  if (threshold.purpose === 'discovery')
    return { tone: 'info' as const, label: threshold.passed ? 'Not reached' : 'Reached' };
  return {
    tone: threshold.passed ? ('pass' as const) : ('fail' as const),
    label: threshold.passed ? 'Passed' : 'Failed',
  };
}
function readingText(threshold: Threshold, rule: PlanRule | undefined): string {
  const reading = threshold.reading;
  if (!reading)
    return rule
      ? `Native reading not recorded; limit ${operator[rule.operator]} ${ruleValue(ruleUnit(rule), rule.value)}.`
      : 'Native reading not recorded.';
  if (rule && (reading.metric !== rule.metric || reading.stat !== rule.stat))
    return 'Native reading does not match the saved rule.';
  const unit = ruleUnit(reading);
  const value = rule ? observedRuleValue(unit, reading.value, rule.value) : ruleValue(unit, reading.value);
  return rule
    ? `${value}; limit ${operator[rule.operator]} ${ruleValue(ruleUnit(rule), rule.value)}`
    : `${value}; saved limit unavailable.`;
}
function fill(threshold: Threshold, rule: PlanRule | undefined): number | null {
  const reading = threshold.reading;
  if (!reading || !rule || rule.value <= 0 || reading.metric !== rule.metric || reading.stat !== rule.stat) return null;
  return Math.min(1, reading.value / rule.value) * 100;
}
/** Native verdict is authoritative; the meter never reevaluates it or uses a histogram estimate. */
export function ThresholdReading({ threshold, rules }: { threshold: Threshold; rules: readonly PlanRule[] }) {
  const rule = threshold.purpose === 'slo' ? rules.find((item) => item.id === threshold.id) : undefined;
  const state = status(threshold);
  const width = fill(threshold, rule);
  return (
    <li className={`result-card result-threshold-card${state.tone === 'fail' ? ' is-failed' : ''}`}>
      <div className="result-threshold-top">
        <Status tone={state.tone}>{state.label}</Status>
        <span className="result-muted number">{readingText(threshold, rule)}</span>
      </div>
      <p>{rule ? ruleName(rule) : threshold.id}</p>
      {width !== null && (
        <span className="result-threshold-meter" aria-hidden="true">
          <span style={{ width: `${width}%` }} />
        </span>
      )}
      <span className="sr-only">
        {threshold.purpose === 'discovery'
          ? 'Discovery trigger; native comparison is inverted.'
          : 'Native engine verdict.'}
      </span>
    </li>
  );
}
