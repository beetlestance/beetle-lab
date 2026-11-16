import { describe, expect, it } from 'vitest';
import { compileLoadPlan } from '../../compiler/index.js';
import type { ValidatedLoadPlan } from '../../compiler/index.js';
import { validateAndCompileLoadPlan, validateLoadPlan } from '../../compiler/validation.js';
import { arrival, discovery, planWith, rawPlan, scenarios } from './fixtures.js';

function invalid(input: unknown): void {
  const result = validateAndCompileLoadPlan(input);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('Invalid fixture accepted');
  expect(result.issues.length).toBeGreaterThan(0);
  expect(result.issues.length).toBeLessThanOrEqual(16);
  expect(Object.isFrozen(result.issues)).toBe(true);
  expect(result).not.toHaveProperty('value');
}

describe('closed schema and bounded semantic validation', () => {
  it.each([0, -1, NaN, Infinity, 1.5, 1_000_001, Number.MAX_SAFE_INTEGER + 1])('rejects invalid arrival rate %s', rate => {
    invalid(rawPlan([{ ...arrival, rate }]));
  });

  it.each(['-1s', '1.5s', '1s2ms', '1d', '00s', ' 1s', '1s ', 'NaNs', '1e3s', '999999999h', '0s'])('rejects invalid workload duration %s', duration => {
    invalid(rawPlan([{ ...arrival, duration }]));
  });

  it('rejects wrong version, missing fields, legacy shapes and request/runtime fields', () => {
    for (const input of [null, [], {}, { version: 2, scenarios: [arrival], slos: [] },
      { version: 1, scenarios: [arrival] }, { executor: 'constant-vus', duration: '1s' },
      { ...planWith([arrival]), endpoints: [] }, { ...planWith([arrival]), bodyFile: '/tmp/secret' },
      { ...planWith([arrival]), preStart: 'echo secret' }, { ...planWith([arrival]), env: {} },
      rawPlan([{ ...arrival, exec: 'arbitraryFunction' }]), rawPlan([{ ...arrival, vus: 10 }]),
      rawPlan([{ ...arrival, executor: 'unknown' }]), rawPlan([{ ...arrival, loadDuration: '1s' }]),
    ]) invalid(input);
  });

  it('rejects invalid VU capacity, stages and zero rate starts/targets', () => {
    for (const item of [
      { ...arrival, preAllocatedVUs: 9, maxVUs: 8 }, { ...arrival, maxVUs: 0 },
      { ...arrival, timeUnit: '0s' }, { ...arrival, preAllocatedVUs: 100_001 },
      { ...scenarios[1], startRate: 0 }, { ...scenarios[1], stages: [] },
      { ...scenarios[1], stages: [{ duration: '1s', target: 0 }] },
      { ...scenarios[1], stages: [{ duration: '0s', target: 10 }] },
      { ...scenarios[1], stages: [{ duration: '1s', rate: 10 }] },
      { ...scenarios[2], startVUs: -1 }, { ...scenarios[2], stages: [{ duration: '1s', target: -1 }] },
      { ...scenarios[4], iterations: 0 }, { ...scenarios[5], iterations: 1.5 },
      { ...scenarios[5], iterations: 1_000_000_001 }, { ...scenarios[4], maxDuration: '0ms' },
    ]) invalid(rawPlan([item]));
  });

  it('rejects zero, negative, nonfinite or oversized ramps without expanding work', () => {
    for (const patch of [{ stepRate: 0 }, { stepRate: -1 }, { stepRate: Infinity }, { stepRate: 0.1 },
      { startRate: 0 }, { maxRate: 0 }, { maxRate: 9 }, { maxRate: Number.MAX_SAFE_INTEGER },
      { startRate: 1, maxRate: 130, stepRate: 1 }, { stepDuration: '0s' }, { stopRule: undefined },
    ]) invalid(rawPlan([{ ...discovery, ...patch }]));
  });

  it('also guards ramp arithmetic against forged internal typed inputs', () => {
    for (const patch of [{ stepRate: 0 }, { stepRate: -1 }, { maxRate: NaN },
      { maxRate: Infinity }, { stepRate: Number.MAX_SAFE_INTEGER }, { maxRate: 1_000_000 },
    ]) {
      const forged = rawPlan([{ ...discovery, ...patch }]) as ValidatedLoadPlan;
      expect(compileLoadPlan(forged).ok).toBe(false);
    }
  });

  it('returns an isolated deeply frozen validation snapshot', () => {
    const input = planWith();
    const result = validateLoadPlan(input);
    if (!result.ok) throw new Error('Invalid fixture');
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value.scenarios)).toBe(true);
    expect(Object.isFrozen(result.value.scenarios[1])).toBe(true);
    const ramp = result.value.scenarios[1];
    if (ramp?.executor !== 'ramping-arrival-rate') throw new Error('Incorrect fixture executor');
    expect(Object.isFrozen(ramp.stages)).toBe(true);
    expect(Object.isFrozen(ramp.stages[0])).toBe(true);
    input.scenarios[0]!.name = 'callerChanged';
    expect(result.value.scenarios[0]?.name).toBe('arrival');
  });

  it('rejects excessive collection sizes before option emission', () => {
    invalid(rawPlan(Array.from({ length: 65 }, (_, index) => ({ ...arrival, id: `id${index}`, name: `name${index}` }))));
    invalid(rawPlan([{ ...scenarios[1], stages: Array.from({ length: 129 }, () => ({ duration: '1s', target: 1 })) }]));
    invalid({ ...planWith([arrival]), slos: Array.from({ length: 129 }, (_, index) => ({ ...discovery.stopRule, id: `rule${index}` })) });
    invalid(rawPlan([]));
  });

  it('rejects combined stage, grace, offset and total wall-clock duration overflow', () => {
    for (const item of [{ ...arrival, duration: '25h' }, { ...arrival, startTime: '25h' },
      { ...arrival, gracefulStop: '3600001ms' }, { ...scenarios[2], gracefulRampDown: '2h' },
      { ...scenarios[1], stages: [{ duration: '24h', target: 1 }, { duration: '1ms', target: 2 }] },
      { ...arrival, duration: '24h', startTime: '24h', gracefulStop: '1ms' },
      { ...discovery, startRate: 1, maxRate: 129, stepRate: 1, stepDuration: '1h' },
    ]) invalid(rawPlan([item]));
  });

  it('rejects duplicate scenario IDs/names and duplicate rule IDs across kinds', () => {
    invalid(rawPlan([arrival, arrival]));
    invalid(rawPlan([arrival, { ...arrival, id: 'different' }]));
    invalid(rawPlan([arrival, { ...arrival, name: 'different' }]));
    const input = planWith([discovery]);
    input.slos = [{ ...discovery.stopRule }];
    invalid(input);
    invalid(rawPlan([discovery, { ...discovery, id: 'second', name: 'second' }]));
  });

  it('rejects malformed threshold structures instead of accepting a permissive DSL', () => {
    for (const patch of [{ operator: '==' }, { metric: 'http_req_duration{scenario:x}' },
      { metric: '__proto__.x' }, { stat: 'p101' }, { value: NaN }, { value: -1 },
      { value: 1_000_000_000_001 }, { threshold: 'p(99)<100' }, { abortOnFail: true },
    ]) invalid(rawPlan([{ ...discovery, stopRule: { ...discovery.stopRule, ...patch } }]));
    invalid({ ...planWith([arrival]), slos: ['http_req_duration{p99} < 10'] });
  });

  it('bounds issue output and excludes attacker-controlled error text', () => {
    const secret = 'CANARY_DO_NOT_ECHO';
    const result = validateAndCompileLoadPlan(rawPlan([{ ...arrival, executor: secret, injected: secret }]));
    expect(JSON.stringify(result)).not.toContain(secret);
    if (result.ok) throw new Error('Invalid fixture accepted');
    expect(result.issues.length).toBeLessThanOrEqual(16);
    expect(result.issues.every(issue => Object.keys(issue).sort().join(',') === 'code,path')).toBe(true);
  });

  it('rejects accessors, cycles, sparse arrays, exotic objects and excessive bytes without exposing values', () => {
    let accessed = false;
    const getter = { get version() { accessed = true; throw new Error('SECRET'); } };
    invalid(getter);
    expect(accessed).toBe(false);
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    invalid(cycle);
    invalid({ ...planWith([arrival]), scenarios: new Array(1) });
    invalid(Object.create({ version: 1 }));
    invalid({ ...planWith([arrival]), injected: 'x'.repeat(1_048_577) });
    invalid({ ...planWith([arrival]), scenarios: new Array(4097).fill(arrival) });
  });
});
