import type { RunComparisonItem, RunComparisonScenarioIntent } from '@beetle/contracts/api';
import { executorText } from '../../../lib/k6-executors.js';
import { formatNumber } from '../../run-results/format.js';
export type ScenarioFact = 'executor' | 'arrival' | 'vus';
/** Configuration intent only. Scenarios keep their own IDs and source units; no pooling or rescaling. */
export function scenarioFact(item: RunComparisonItem, fact: ScenarioFact): string {
  const scenarios = item.scenarioIntents;
  if (!scenarios) return 'Configuration intent unavailable';
  return scenarios.map((s) => `${scenarios.length > 1 ? s.id + ': ' : ''}${factText(s, fact)}`).join('; ');
}
function factText(s: RunComparisonScenarioIntent, fact: ScenarioFact): string {
  if (fact === 'executor') return executorText[s.executor]?.label ?? s.executor;
  if (fact === 'arrival') return arrival(s);
  const { initial, maximum } = s.vus;
  if (s.arrivalRate)
    return `${formatNumber(initial, 'integer')} preallocated; ${formatNumber(maximum, 'integer')} maximum`;
  return s.executor === 'ramping-vus'
    ? `Starts at ${formatNumber(initial, 'integer')}; up to ${formatNumber(maximum, 'integer')}`
    : (formatNumber(initial, 'integer') ?? 'Unknown');
}

function arrival(s: RunComparisonScenarioIntent): string {
  const rate = s.arrivalRate;
  if (!rate) return 'Not an arrival-rate executor';
  const max = `${formatNumber(rate.maximum, 'integer')} per ${rate.timeUnit}`;
  return s.executor === 'constant-arrival-rate'
    ? max
    : `Starts at ${formatNumber(rate.initial, 'integer')} per ${rate.timeUnit}; configured maximum ${max}`;
}
