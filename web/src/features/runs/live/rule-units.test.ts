import { expect, it } from 'vitest';
import { observedRuleValue, ruleUnit, ruleValue } from './rule-units.js';
it('keeps rates, durations, counters and unsupported dimensions distinct', () => {
  const cases: [string,string,ReturnType<typeof ruleUnit>][] = [
    ['checks','rate','ratio'],['http_req_failed','rate','ratio'],['http_req_duration','avg','ms'],
    ['data_sent','count','bytes'],['data_received','rate','bytes/s'],['iterations','rate','count/s'],
    ['vus','value','count'],['custom_metric','p95',null],['http_req_duration','count',null],
  ];
  for(const [metric,stat,unit] of cases)expect(ruleUnit({metric,stat})).toBe(unit);
  expect(ruleValue('ratio',0.99)).toBe('99%');
  expect(ruleValue('count',1.5)).toBe('1.5');
  expect(ruleValue(null,3)).toBe('3 (unit unknown)');
  expect(ruleValue('ms',0.000000001)).toBe('1.00e-9 ms');
});

it('keeps observed failure and checks rates short without rounding through the limit', () => {
  expect(observedRuleValue('ratio', 1/1201, .01)).toBe('0.08%');
  expect(observedRuleValue('ratio', .9996, .99)).toBe('99.96%');
  expect(observedRuleValue('ratio', .009999, .01)).toBe('0.9999%');
  expect(observedRuleValue('ratio', 1/100000, .01)).toBe('<0.01%');
  expect(observedRuleValue('ratio', 1/100000, 1/50000)).toBe('0.001%');
  expect(observedRuleValue('ratio', 0, .01)).toBe('0%');
});
