import { describe, expect, it } from 'vitest';
import type { ThresholdRule } from '../../compiler/index.js';
import { compiled, discovery, planWith, arrival } from './fixtures.js';

function evaluate(expression: string, observation: number): boolean {
  const match = /^p\(99\)(<=|>=|<|>)(\d+)$/.exec(expression);
  if (!match) throw new Error('Invalid oracle expression');
  const value = Number(match[2]);
  switch (match[1]) {
    case '<=': return observation <= value;
    case '>=': return observation >= value;
    case '<': return observation < value;
    case '>': return observation > value;
    default: throw new Error('Invalid oracle operator');
  }
}

describe('discovery threshold identity and logical inverse', () => {
  const vectors: { operator: ThresholdRule['operator']; expression: string; passing: boolean[] }[] = [
    { operator: '>', expression: 'p(99)<=10', passing: [true, true, false] },
    { operator: '>=', expression: 'p(99)<10', passing: [true, false, false] },
    { operator: '<', expression: 'p(99)>=10', passing: [false, true, true] },
    { operator: '<=', expression: 'p(99)>10', passing: [false, false, true] },
  ];
  for (const vector of vectors) {
    it(`negates ${vector.operator} at below/equal/above boundaries`, () => {
      const input = planWith([{ ...discovery, stopRule: { ...discovery.stopRule, operator: vector.operator } }]);
      const output = compiled(input);
      const emitted = output.options.thresholds.http_req_duration?.[0];
      expect(emitted).toEqual({ threshold: vector.expression, abortOnFail: true });
      expect([9, 10, 11].map(value => evaluate(emitted!.threshold, value))).toEqual(vector.passing);
      expect(output.thresholds[0]).toMatchObject({ kind: 'discovery', id: 'discovery_stop',
        scenarioId: 'discovery', rule: { operator: vector.operator }, abortScope: 'all-scenarios' });
    });
  }

  it('retains all SLOs and distinct discovery rules on one metric', () => {
    const input = planWith([arrival, discovery, { ...discovery, id: 'later', name: 'later', startTime: '12s',
      stopRule: { ...discovery.stopRule, id: 'later_stop', operator: '<=' } }]);
    input.slos = [
      { ...discovery.stopRule, id: 'latency_slo', operator: '<', value: 100 },
      { ...discovery.stopRule, id: 'minimum_slo', stat: 'min', operator: '>=', value: 1 },
    ];
    const output = compiled(input);
    expect(output.options.thresholds.http_req_duration).toEqual([
      { threshold: 'p(99)<100', abortOnFail: false }, { threshold: 'min>=1', abortOnFail: false },
      { threshold: 'p(99)<=10', abortOnFail: true }, { threshold: 'p(99)>10', abortOnFail: true },
    ]);
    expect(output.thresholds.map(item => [item.id, item.kind])).toEqual([
      ['latency_slo', 'slo'], ['minimum_slo', 'slo'], ['discovery_stop', 'discovery'], ['later_stop', 'discovery'],
    ]);
    expect(Object.keys(output.options.scenarios)).toEqual(['arrival', 'discovery', 'later']);
    expect(output.discovery).toEqual([
      { scenarioId: 'discovery', ruleId: 'discovery_stop', abortScope: 'all-scenarios',
        affectedScenarioIds: ['arrival', 'discovery', 'later'], companionScenarioIds: ['arrival', 'later'],
        exhaustionOutcome: 'inconclusive', requiresObservedRuleFailure: true },
      { scenarioId: 'later', ruleId: 'later_stop', abortScope: 'all-scenarios',
        affectedScenarioIds: ['arrival', 'discovery', 'later'], companionScenarioIds: ['arrival', 'discovery'],
        exhaustionOutcome: 'inconclusive', requiresObservedRuleFailure: true },
    ]);
  });

  it('emits SLOs without inversion or early abort, including a zero boundary', () => {
    const input = planWith([arrival]);
    input.slos = [{ ...discovery.stopRule, metric: 'http_req_failed', stat: 'rate', operator: '<=', value: 0 }];
    const output = compiled(input);
    expect(output.options.thresholds.http_req_failed).toEqual([{ threshold: 'rate<=0', abortOnFail: false }]);
    expect(output.discovery).toEqual([]);
    expect(output.thresholds[0]?.abortScope).toBe('none');
  });
});
