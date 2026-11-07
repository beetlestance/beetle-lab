import type { K6Scenario, ReadonlyScenario } from './types.js';
import { rampStageCount } from './analysis.js';

/** Names are fixed compiler data; the later runtime must supply these entrypoints. */
export function compileScenario(scenario: ReadonlyScenario, index: number): K6Scenario {
  const base = { exec: `loadScenario${index}`, startTime: scenario.startTime, gracefulStop: scenario.gracefulStop };
  switch (scenario.executor) {
    case 'constant-arrival-rate':
      return { ...base, executor: scenario.executor, rate: scenario.rate, timeUnit: scenario.timeUnit,
        duration: scenario.duration, preAllocatedVUs: scenario.preAllocatedVUs, maxVUs: scenario.maxVUs };
    case 'ramping-arrival-rate':
      return { ...base, executor: scenario.executor, startRate: scenario.startRate, timeUnit: scenario.timeUnit,
        stages: scenario.stages.map(stage => ({ ...stage })), preAllocatedVUs: scenario.preAllocatedVUs, maxVUs: scenario.maxVUs };
    case 'ramping-vus':
      return { ...base, executor: scenario.executor, startVUs: scenario.startVUs,
        stages: scenario.stages.map(stage => ({ ...stage })), gracefulRampDown: scenario.gracefulRampDown };
    case 'constant-vus':
      return { ...base, executor: scenario.executor, vus: scenario.vus, duration: scenario.duration };
    case 'shared-iterations':
    case 'per-vu-iterations':
      return { ...base, executor: scenario.executor, vus: scenario.vus,
        iterations: scenario.iterations, maxDuration: scenario.maxDuration };
    case 'ramp-until':
      return { ...base, executor: 'ramping-arrival-rate', startRate: scenario.startRate, timeUnit: scenario.timeUnit,
        preAllocatedVUs: scenario.preAllocatedVUs, maxVUs: scenario.maxVUs,
        stages: Array.from({ length: rampStageCount(scenario) }, (_, index) => ({ duration: scenario.stepDuration,
          target: Math.min(scenario.maxRate, scenario.startRate + (index + 1) * scenario.stepRate) })) };
  }
}
