import { describe, expect, it } from 'vitest';
import { compileLoadPlan } from '../../compiler/index.js';
import type { Scenario, ValidatedLoadPlan } from '../../compiler/index.js';
import { compileScenario } from '../../compiler/scenarios.js';
import { validateAndCompileLoadPlan } from '../../compiler/validation.js';
import { arrival, compiled, discovery, planWith, rawPlan, scenarios } from './fixtures.js';

const constant = scenarios[3]! as Extract<Scenario, { executor: 'constant-vus' }>;
const shared = scenarios[4]! as Extract<Scenario, { executor: 'shared-iterations' }>;
const perVu = scenarios[5]! as Extract<Scenario, { executor: 'per-vu-iterations' }>;
const rampVus = scenarios[2]! as Extract<Scenario, { executor: 'ramping-vus' }>;

function fixedDurationScenarios(value: string): Scenario[] {
  return [{ ...arrival, duration: value }, { ...constant, duration: value },
    { ...shared, maxDuration: value }, { ...perVu, maxDuration: value }];
}

describe('native executor compatibility boundaries', () => {
  it('rejects subsecond constant durations and iteration maxDurations', () => {
    for (const value of ['1ms', '999ms']) {
      for (const scenario of fixedDurationScenarios(value)) {
        expect(validateAndCompileLoadPlan(rawPlan([scenario])).ok).toBe(false);
        // Semantic compilation also enforces the minimum for internal typed misuse.
        expect(compileLoadPlan(rawPlan([scenario]) as ValidatedLoadPlan).ok).toBe(false);
      }
    }
  });

  it.each(['1s', '1000ms'])('accepts the exact one-second minimum expressed as %s', value => {
    const output = compiled(planWith(fixedDurationScenarios(value)));
    expect(output.execution.scenarios.map(item => item.activeDurationMs)).toEqual([1000, 1000, 1000, 1000]);
    expect(output.execution.upperBoundMs).toBe(6000);
  });

  it('preserves millisecond stages for both ramping executors and discovery', () => {
    const rampArrival = scenarios[1]! as Extract<Scenario, { executor: 'ramping-arrival-rate' }>;
    const output = compiled(planWith([
      { ...rampArrival, stages: [{ duration: '1ms', target: 1 }] },
      { ...rampVus, stages: [{ duration: '1ms', target: 1 }], gracefulRampDown: '1ms' },
      { ...discovery, startRate: 1, maxRate: 2, stepRate: 1, stepDuration: '1ms' },
    ]));
    expect(output.execution.scenarios.map(item => item.activeDurationMs)).toEqual([1, 1, 1]);
    expect(output.execution.upperBoundMs).toBe(5002);
  });

  it('rejects shared iteration counts below VUs', () => {
    const input = rawPlan([{ ...shared, vus: 2, iterations: 1, maxDuration: '1s' }]);
    const result = validateAndCompileLoadPlan(input);
    expect(result).toMatchObject({ ok: false, issues: [{ path: '/scenarios/0/iterations', code: 'capacity' }] });
  });

  it('accepts shared equality and per-VU counts below VUs with distinct totals', () => {
    const output = compiled(planWith([
      { ...shared, vus: 2, iterations: 2, maxDuration: '1s' },
      { ...perVu, vus: 2, iterations: 1, maxDuration: '1s' },
    ]));
    expect(output.execution.scenarios.map(item => item.iterations)).toEqual([
      { mode: 'shared', total: 2 }, { mode: 'per-vu', perVu: 1, total: 2 },
    ]);
  });

  it('rejects ramping VUs with zero start and all-zero stage targets', () => {
    const input = rawPlan([{ ...rampVus, startVUs: 0,
      stages: [{ duration: '1ms', target: 0 }, { duration: '1ms', target: 0 }] }]);
    expect(validateAndCompileLoadPlan(input)).toMatchObject({ ok: false,
      issues: [{ path: '/scenarios/0/stages', code: 'capacity' }] });
  });

  it('accepts a positive start ramping down to zero and a later positive target', () => {
    const output = compiled(planWith([
      { ...rampVus, id: 'ramp_down', name: 'ramp_down', startVUs: 1,
        stages: [{ duration: '1ms', target: 0 }] },
      { ...rampVus, startVUs: 0, stages: [{ duration: '1ms', target: 0 }, { duration: '1ms', target: 1 }] },
    ]));
    expect(output.options.scenarios.ramp_down).toMatchObject({ startVUs: 1, stages: [{ duration: '1ms', target: 0 }] });
    expect(output.execution.scenarios.map(item => item.activeDurationMs)).toEqual([1, 2]);
  });

  it('guards forged ramp allocation despite extra duration/maxDuration/stages fields', () => {
    const extras = [{ duration: '1s' }, { maxDuration: '1s' }, { stages: [{ duration: '1ms', target: 1 }] },
      { duration: '1s', maxDuration: '1s', stages: [] }];
    const invalidRates = [{ stepRate: 0 }, { stepRate: -1 }, { stepRate: NaN }, { stepRate: Infinity },
      { maxRate: 1_000_000, stepRate: 1 }];
    for (const extra of extras) {
      for (const rates of invalidRates) {
        const forged = { ...discovery, ...extra, ...rates };
        const result = compileLoadPlan(rawPlan([forged]) as ValidatedLoadPlan);
        expect(result.ok).toBe(false);
        expect(result).not.toHaveProperty('value');
        // The emission helper independently checks immediately before allocation.
        expect(compileScenario(forged, 0)).toMatchObject({ ok: false });
      }
    }
  });
});
