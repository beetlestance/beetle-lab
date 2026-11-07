import type { CompiledLoadPlan, LoadPlan, Scenario, ThresholdRule } from '../../compiler/index.js';
import { validateAndCompileLoadPlan } from '../../compiler/validation.js';

const base = { startTime: '2s', gracefulStop: '3s' };
const capacity = { preAllocatedVUs: 2, maxVUs: 8 };
export const rule: ThresholdRule = { id: 'discovery_stop', metric: 'http_req_duration', stat: 'p99', operator: '>', value: 10 };
export const scenarios: Scenario[] = [
  { ...base, id: 'arrival', name: 'arrival', executor: 'constant-arrival-rate',
    rate: 20, timeUnit: '1s', duration: '10s', ...capacity },
  { ...base, id: 'ramp_arrival', name: 'ramp_arrival', executor: 'ramping-arrival-rate',
    startRate: 1, timeUnit: '1s', stages: [{ duration: '4s', target: 10 }, { duration: '6s', target: 20 }], ...capacity },
  { ...base, id: 'ramp_vus', name: 'ramp_vus', executor: 'ramping-vus', startVUs: 0,
    stages: [{ duration: '4s', target: 10 }, { duration: '6s', target: 0 }], gracefulRampDown: '5s' },
  { ...base, id: 'constant', name: 'constant', executor: 'constant-vus', vus: 4, duration: '10s' },
  { ...base, id: 'shared', name: 'shared', executor: 'shared-iterations', vus: 4, iterations: 7, maxDuration: '10s' },
  { ...base, id: 'pervu', name: 'pervu', executor: 'per-vu-iterations', vus: 4, iterations: 7, maxDuration: '10s' },
  { ...base, id: 'discovery', name: 'discovery', executor: 'ramp-until', startRate: 10,
    maxRate: 20, stepRate: 6, stepDuration: '5s', timeUnit: '1s', ...capacity, stopRule: rule },
];
export const arrival = scenarios[0]! as Extract<Scenario, { executor: 'constant-arrival-rate' }>;
export const discovery = scenarios[6]! as Extract<Scenario, { executor: 'ramp-until' }>;
export function planWith(items: Scenario[] = scenarios): LoadPlan {
  return { version: 1, scenarios: structuredClone(items), slos: [] };
}
export function rawPlan(items: unknown[] = [arrival]): unknown {
  return { version: 1, scenarios: items, slos: [] };
}
export function compiled(input: unknown): CompiledLoadPlan {
  const result = validateAndCompileLoadPlan(input);
  if (!result.ok) throw new Error('Unexpected fixture validation error: ' + JSON.stringify(result.issues));
  return result.value;
}
