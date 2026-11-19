import type { RunComparisonScenarioIntent } from '@beetle/contracts/api';
import type { ComparisonScenario } from './source.js';
/** Projection of submitted intent, not compiler admission, observed traffic or aggregate concurrency. */
export function scenarioIntents(scenarios: readonly ComparisonScenario[]): RunComparisonScenarioIntent[] {
  return scenarios.map((scenario) => ({
    id: scenario.id,
    executor: scenario.executor,
    arrivalRate: arrivalRate(scenario),
    vus: vus(scenario),
  }));
}
function arrivalRate(scenario: ComparisonScenario): RunComparisonScenarioIntent['arrivalRate'] {
  switch (scenario.executor) {
    case 'constant-arrival-rate':
      return { initial: scenario.rate, maximum: scenario.rate, timeUnit: scenario.timeUnit };
    case 'ramping-arrival-rate':
      return {
        initial: scenario.startRate,
        maximum: Math.max(scenario.startRate, ...scenario.stages.map((s) => s.target)),
        timeUnit: scenario.timeUnit,
      };
    case 'ramp-until':
      return { initial: scenario.startRate, maximum: scenario.maxRate, timeUnit: scenario.timeUnit };
    default:
      return null;
  }
}
function vus(scenario: ComparisonScenario): RunComparisonScenarioIntent['vus'] {
  if ('preAllocatedVUs' in scenario) return { initial: scenario.preAllocatedVUs, maximum: scenario.maxVUs };
  if ('startVUs' in scenario)
    return {
      initial: scenario.startVUs,
      maximum: Math.max(scenario.startVUs, ...scenario.stages.map((s) => s.target)),
    };
  return { initial: scenario.vus, maximum: scenario.vus };
}
