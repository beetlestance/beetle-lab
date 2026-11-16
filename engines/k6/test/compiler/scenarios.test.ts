import { describe, expect, it } from 'vitest';
import { compileLoadPlan } from '../../compiler/index.js';
import { validateAndCompileLoadPlan, validateLoadPlan } from '../../compiler/validation.js';
import { arrival, compiled, discovery, planWith, scenarios } from './fixtures.js';

const common = { startTime: '2s', gracefulStop: '3s' };
const expected = [
  { ...common, exec: 'loadScenario0', executor: 'constant-arrival-rate', rate: 20, timeUnit: '1s',
    duration: '10s', preAllocatedVUs: 2, maxVUs: 8 },
  { ...common, exec: 'loadScenario1', executor: 'ramping-arrival-rate', startRate: 1, timeUnit: '1s',
    stages: [{ duration: '4s', target: 10 }, { duration: '6s', target: 20 }], preAllocatedVUs: 2, maxVUs: 8 },
  { ...common, exec: 'loadScenario2', executor: 'ramping-vus', startVUs: 0,
    stages: [{ duration: '4s', target: 10 }, { duration: '6s', target: 0 }], gracefulRampDown: '5s' },
  { ...common, exec: 'loadScenario3', executor: 'constant-vus', vus: 4, duration: '10s' },
  { ...common, exec: 'loadScenario4', executor: 'shared-iterations', vus: 4, iterations: 7, maxDuration: '10s' },
  { ...common, exec: 'loadScenario5', executor: 'per-vu-iterations', vus: 4, iterations: 7, maxDuration: '10s' },
  { ...common, exec: 'loadScenario6', executor: 'ramping-arrival-rate', startRate: 10, timeUnit: '1s',
    preAllocatedVUs: 2, maxVUs: 8, stages: [{ duration: '5s', target: 16 }, { duration: '5s', target: 20 }] },
];

describe('pure k6 load-plan component', () => {
  it('matches independent complete option oracles for all seven executors', () => {
    const output = compiled(planWith());
    expect(Object.values(output.options.scenarios)).toEqual(expected);
    expect(output.component).toBe('k6-load-plan');
    expect(output.execution.upperBoundMs).toBe(20_000);
    expect(output.execution.scenarios.map(item => item.upperBoundMs)).toEqual([15_000, 15_000, 20_000, 15_000, 15_000, 15_000, 15_000]);
    expect(output.execution.scenarios[4]?.iterations).toEqual({ mode: 'shared', total: 7 });
    expect(output.execution.scenarios[5]?.iterations).toEqual({ mode: 'per-vu', perVu: 7, total: 28 });
  });

  it('takes the maximum independent offset, workload and grace bound', () => {
    const output = compiled(planWith([
      { ...arrival, startTime: '30001ms', duration: '1s', gracefulStop: '7ms' },
      { ...discovery, startTime: '0s', gracefulStop: '0s' },
    ]));
    expect(output.execution.upperBoundMs).toBe(31_008);
    expect(output.options.scenarios.arrival).toMatchObject({ startTime: '30001ms', duration: '1s', gracefulStop: '7ms' });
    expect(output.execution.scenarios[0]).toMatchObject({ startOffsetMs: 30_001, activeDurationMs: 1000, gracefulStopMs: 7 });
  });

  it('bounds ramp expansion at 128, includes a nondivisible ceiling and supports a single plateau', () => {
    const output = compiled(planWith([{ ...discovery, startRate: 1, maxRate: 129, stepRate: 1, stepDuration: '1ms' }]));
    const native = output.options.scenarios.discovery;
    expect(native?.executor).toBe('ramping-arrival-rate');
    if (native?.executor !== 'ramping-arrival-rate') throw new Error('Incorrect fixture executor');
    expect(native.stages).toHaveLength(128);
    expect(native.stages[0]).toEqual({ target: 2, duration: '1ms' });
    expect(native.stages.at(-1)).toEqual({ target: 129, duration: '1ms' });
    const plateau = compiled(planWith([{ ...discovery, startRate: 10, maxRate: 10 }]));
    expect(plateau.options.scenarios.discovery).toMatchObject({ stages: [{ target: 10, duration: '5s' }] });
  });

  it('handles the maximum scenario, rule and expanded-stage counts deterministically', () => {
    const items = Array.from({ length: 64 }, (_, index) => ({ ...discovery, id: `scenario${index}`, name: `scenario${index}`,
      startRate: 1, maxRate: 129, stepRate: 1, stepDuration: '1ms',
      stopRule: { ...discovery.stopRule, id: `discovery${index}` } }));
    const input = planWith(items);
    input.slos = Array.from({ length: 128 }, (_, index) => ({ ...discovery.stopRule, id: `slo${index}` }));
    const output = compiled(input);
    expect(Object.keys(output.options.scenarios)).toHaveLength(64);
    expect(output.thresholds).toHaveLength(192);
    expect(output.options.thresholds.http_req_duration).toHaveLength(192);
    expect(output.discovery).toHaveLength(64);
    expect(output).toEqual(compiled(input));
  });

  it('accepts integer units and keeps multiplication of per-VU iterations exact', () => {
    const perVu = scenarios[5]!;
    const output = compiled(planWith([{ ...perVu, executor: 'per-vu-iterations', vus: 100_000, iterations: 1_000_000_000,
      maxDuration: '1h', startTime: '1m', gracefulStop: '1ms' }]));
    expect(output.execution.upperBoundMs).toBe(3_660_001);
    expect(output.execution.scenarios[0]?.iterations?.total).toBe(100_000_000_000_000);
  });

  it('is repeatable and never mutates or retains mutable input nodes', () => {
    const input = planWith();
    input.slos.push({ ...discovery.stopRule, id: 'slo' });
    const before = structuredClone(input);
    const parsed = validateLoadPlan(input);
    if (!parsed.ok) throw new Error('Invalid fixture');
    const first = compileLoadPlan(parsed.value);
    expect(first).toEqual(compileLoadPlan(parsed.value));
    expect(input).toEqual(before);
    if (!first.ok) throw new Error('Invalid fixture semantics');
    first.value.thresholds[0]!.rule.value = 900;
    const ramp = first.value.options.scenarios.ramp_vus;
    if (ramp?.executor !== 'ramping-vus') throw new Error('Incorrect fixture executor');
    ramp.stages[0]!.target = 900;
    expect(parsed.value).toEqual(before);
    expect(input).toEqual(before);
  });

  it('preserves prototype-looking IDs, names and metric keys as own data', () => {
    const input = planWith([{ ...arrival, id: '__proto__', name: '__proto__' },
      { ...discovery, id: 'constructor', name: 'constructor', stopRule: { ...discovery.stopRule, metric: '__proto__' } }]);
    input.slos = [{ ...discovery.stopRule, id: '__proto__', metric: 'constructor' }];
    const output = compiled(input);
    expect(Object.keys(output.options.scenarios)).toEqual(['__proto__', 'constructor']);
    expect(Object.getPrototypeOf(output.options.scenarios)).toBe(null);
    expect(Object.getPrototypeOf(output.options.thresholds)).toBe(null);
    expect(Object.hasOwn(output.options.thresholds, '__proto__')).toBe(true);
    expect(Object.hasOwn(output.options.thresholds, 'constructor')).toBe(true);
    expect(JSON.parse(JSON.stringify(output)).options.scenarios.__proto__.rate).toBe(20);
  });

  it('never constructs emitted options for semantic errors', () => {
    const result = validateAndCompileLoadPlan(planWith([{ ...discovery, maxRate: 9 }]));
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty('value');
  });
});
