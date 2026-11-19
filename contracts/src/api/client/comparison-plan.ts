import type { RunComparisonItem, RunComparisonScenarioIntent } from '../generated/types.js';
/** Projection consistency only; intentionally does not turn intent into engine admission. */
export function comparisonScenarioIntentsMatch(scenarios: RunComparisonItem['scenarioIntents']): boolean {
  if (scenarios === undefined) return true;
  return scenarios.every((scenario) => {
    const arrival = ['constant-arrival-rate', 'ramping-arrival-rate', 'ramp-until'].includes(scenario.executor);
    if (arrival !== (scenario.arrivalRate !== null)) return false;
    if (!arrivalProjectionMatches(scenario)) return false;
    if (['constant-vus', 'per-vu-iterations', 'shared-iterations'].includes(scenario.executor))
      return scenario.vus.initial === scenario.vus.maximum;
    if (scenario.executor === 'ramping-vus') return scenario.vus.maximum >= scenario.vus.initial;
    return true;
  });
}

function arrivalProjectionMatches(scenario: RunComparisonScenarioIntent): boolean {
  const rate = scenario.arrivalRate;
  if (!rate) return true;
  switch (scenario.executor) {
    case 'constant-arrival-rate':
      return rate.initial === rate.maximum;
    case 'ramping-arrival-rate':
      return rate.maximum >= rate.initial;
    default:
      return true;
  }
}
