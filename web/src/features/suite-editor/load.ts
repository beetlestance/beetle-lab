import { objects, text } from './model.js';
import type { Obj } from './model.js';

export const executors = [
  {
    id: 'ramping-arrival-rate',
    label: 'Ramping arrival rate',
    hint: 'Starts requests at a rate that changes stage by stage, however slow the target gets. Best for capacity and sale-day checks.',
  },
  {
    id: 'constant-arrival-rate',
    label: 'Constant arrival rate',
    hint: 'Starts requests at one fixed rate for the whole test, however slow the target gets.',
  },
  {
    id: 'ramping-vus',
    label: 'Ramping virtual users',
    hint: 'Changes the number of virtual users stage by stage. Each user sends its next request when the last one returns.',
  },
  {
    id: 'constant-vus',
    label: 'Constant virtual users',
    hint: 'Keeps a fixed number of virtual users busy for the whole test.',
  },
  {
    id: 'shared-iterations',
    label: 'Shared iterations',
    hint: 'Virtual users share a fixed number of iterations and stop when all are done.',
  },
  {
    id: 'per-vu-iterations',
    label: 'Iterations per virtual user',
    hint: 'Each virtual user runs the same number of iterations, then stops.',
  },
  {
    id: 'ramp-until',
    label: 'Ramp until a rule fails',
    hint: 'Raises the rate step by step until a stop rule fails or the top rate is reached. A failed stop rule ends the whole test.',
  },
] as const;
export const executorLabel = (id: unknown) => executors.find((item) => item.id === id)?.label ?? text(id, 'Unknown');

const units = { ms: 0.001, s: 1, m: 60, h: 3600 } as const;
export function seconds(value: unknown): number | undefined {
  const match = /^(0|[1-9][0-9]{0,8})(ms|s|m|h)$/.exec(text(value));
  return match ? Number(match[1]) * units[match[2] as keyof typeof units] : undefined;
}
const count = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : fallback;

/** Peak rate or user count, used to carry the scale across an executor change. */
export function peakOf(scenario: Obj): number {
  const stages = objects(scenario.stages).map((stage) => count(stage.target, 0));
  return Math.max(count(scenario.rate, 0), count(scenario.maxRate, 0), count(scenario.vus, 0), ...stages, 1);
}
export function switchExecutor(scenario: Obj, executor: string): Obj {
  const base = {
    id: scenario.id,
    name: scenario.name,
    startTime: scenario.startTime ?? '0s',
    gracefulStop: scenario.gracefulStop ?? '30s',
    executor,
  };
  const peak = peakOf(scenario);
  const vus = count(scenario.maxVUs, count(scenario.vus, 10));
  const pool = { preAllocatedVUs: count(scenario.preAllocatedVUs, vus), maxVUs: vus };
  // A ramp must rise above where it drains to, or the ramp/hold/drain view cannot show it.
  const shape = (end: number, top = peak > end ? peak : 10) => [
    { duration: '60s', target: top },
    { duration: '480s', target: top },
    { duration: '60s', target: end },
  ];
  switch (executor) {
    case 'constant-arrival-rate':
      return { ...base, rate: peak, timeUnit: '1s', duration: '10m', ...pool };
    case 'ramping-arrival-rate':
      return { ...base, startRate: 1, timeUnit: '1s', stages: shape(1), ...pool };
    case 'ramping-vus':
      return { ...base, startVUs: 0, stages: shape(0), gracefulRampDown: '30s' };
    case 'constant-vus':
      return { ...base, vus, duration: '10m' };
    case 'shared-iterations':
      return { ...base, iterations: 100, vus, maxDuration: '10m' };
    case 'per-vu-iterations':
      return { ...base, iterations: 1, vus, maxDuration: '10m' };
    case 'ramp-until':
      return {
        ...base,
        startRate: 1,
        maxRate: peak,
        stepRate: Math.max(1, Math.round(peak / 10)),
        stepDuration: '30s',
        timeUnit: '1s',
        ...pool,
        stopRule: { id: 'stop', metric: 'http_req_duration', stat: 'p95', operator: '>', value: 500 },
      };
    default:
      return { ...scenario, executor };
  }
}

/** The common three-stage plan: ramp to a peak, hold it, then drain. */
export function rampHoldDrain(scenario: Obj) {
  if (scenario.executor !== 'ramping-arrival-rate' && scenario.executor !== 'ramping-vus') return null;
  const stages = objects(scenario.stages);
  if (stages.length !== 3) return null;
  const [up, hold, down] = stages as [Obj, Obj, Obj];
  const durations = stages.map((stage) => seconds(stage.duration));
  if (durations.some((value) => value === undefined || !Number.isInteger(value))) return null;
  if (typeof up.target !== 'number' || up.target !== hold.target || typeof down.target !== 'number') return null;
  if (down.target >= up.target) return null;
  return { peak: up.target, ramp: durations[0]!, hold: durations[1]!, drain: durations[2]!, end: down.target };
}
export function setRampHoldDrain(
  scenario: Obj,
  field: 'peak' | 'ramp' | 'hold' | 'drain',
  value: number | string,
): Obj {
  const stages = objects(scenario.stages).map((stage) => ({ ...stage }));
  if (stages.length !== 3) return scenario;
  if (field === 'peak') {
    stages[0]!.target = value;
    stages[1]!.target = value;
  } else {
    const index = { ramp: 0, hold: 1, drain: 2 }[field];
    stages[index]!.duration = typeof value === 'number' ? `${value}s` : value;
  }
  return { ...scenario, stages };
}
export const isArrival = (scenario: Obj) =>
  ['constant-arrival-rate', 'ramping-arrival-rate', 'ramp-until'].includes(text(scenario.executor));
