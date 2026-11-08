import { expect, it } from 'vitest';
import { mapK6Result } from '../../wrapper/result/index.js';
import { configFor } from '../runtime/fixtures.js';
import { count, discoveryConfig, fixture, threshold } from './fixtures.js';

it.each([true, false, null])('maps native ordinary SLO verdict=%s without numeric reevaluation', ok => {
  const config = configFor();
  config.loadPlan.slos = [{ id: 'latency', metric: 'http_req_duration', stat: 'p95', operator: '<', value: 10 }];
  const input = fixture(config); threshold(input, 'http_req_duration', 'p(95)<10', ok);
  input.process.exitCode = ok === false ? 99 : 0;
  const result = mapK6Result(input); expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('Expected mapping');
  expect(result.body.outcome).toBe(ok === null ? 'inconclusive' : ok ? 'passed' : 'failed');
  expect(result.body.thresholds).toEqual(ok === null ? [] : [{ id: 'latency', purpose: 'slo', passed: ok }]);
});
it('retains duplicate native expressions as separately configured rule IDs', () => {
  const config = configFor();
  config.loadPlan.slos = ['one', 'two'].map(id => ({ id, metric: 'http_reqs', stat: 'count', operator: '>' as const, value: 1 }));
  const input = fixture(config);
  expect(mapK6Result(input)).toMatchObject({ ok: true, body: { thresholds: [
    { id: 'one', purpose: 'slo', passed: true }, { id: 'two', purpose: 'slo', passed: true },
  ] } });
});
it('preserves native inverse discovery false as the observed comparison witness', () => {
  const input = fixture(discoveryConfig()); input.process.exitCode = 99;
  threshold(input, 'http_req_duration', 'p(95)<=10', false);
  expect(mapK6Result(input)).toMatchObject({ ok: true, body: { mode: 'discovery', outcome: 'passed',
    expectedAbort: { ruleId: 'stop', reached: true }, thresholds: [{ id: 'stop', purpose: 'discovery', passed: false }] } });
});
it.each([true, null])('keeps discovery exhaustion/missing verdict=%s inconclusive', ok => {
  const input = fixture(discoveryConfig()); threshold(input, 'http_req_duration', 'p(95)<=10', ok);
  expect(mapK6Result(input)).toMatchObject({ ok: true, body: { mode: 'discovery', outcome: 'inconclusive',
    expectedAbort: { ruleId: 'stop', reached: false }, completeness: ok === null ? 'partial' : 'complete' } });
});
it('requires native99 for a discovery pass, without inferring early termination from a witness', () => {
  const input = fixture(discoveryConfig()); threshold(input, 'http_req_duration', 'p(95)<=10', false);
  expect(mapK6Result(input)).toMatchObject({ ok: true, body: { outcome: 'inconclusive',
    expectedAbort: { ruleId: 'stop', reached: true } } });
});
it('selects the first reached rule in compiled order, retaining every known discovery verdict', () => {
  const config = discoveryConfig();
  const first = config.loadPlan.scenarios[0]!;
  if (first.executor !== 'ramp-until') throw new Error('Expected discovery');
  config.loadPlan.scenarios.push({ ...first, id: 'second', name: 'second',
    stopRule: { ...first.stopRule, id: 'second-stop', metric: 'http_reqs', stat: 'count', value: 2 } });
  config.selections.push({ ...structuredClone(config.selections[0]!), scenarioId: 'second' });
  const input = fixture(config); input.process.exitCode = 99;
  threshold(input, 'http_req_duration', 'p(95)<=10', false); threshold(input, 'http_reqs', 'count<=2', false);
  expect(mapK6Result(input)).toMatchObject({ ok: true, body: { outcome: 'passed', expectedAbort: { ruleId: 'stop', reached: true },
    thresholds: [{ id: 'stop', purpose: 'discovery', passed: false }, { id: 'second-stop', purpose: 'discovery', passed: false }] } });
  threshold(input, 'http_req_duration', 'p(95)<=10', null);
  expect(mapK6Result(input)).toMatchObject({ ok: true, body: { outcome: 'inconclusive', completeness: 'partial',
    expectedAbort: { ruleId: 'second-stop', reached: true } } });
});
it('does not let a discovery witness conceal unrelated required failure', () => {
  const input = fixture(discoveryConfig()); input.process.exitCode = 99;
  threshold(input, 'http_req_duration', 'p(95)<=10', false);
  count(input, 'beetle_assertion_failures{assertion:a0}', 1); count(input, 'beetle_required_failures', 1);
  threshold(input, 'beetle_required_failures', 'count==0', false);
  expect(mapK6Result(input)).toMatchObject({ ok: true, body: { outcome: 'failed', expectedAbort: { reached: true } } });
});
it.each([true, false])('ignores vacuous Trend verdict=%s without samples, including as exit99 explanation', ok => {
  const config = configFor();
  config.loadPlan.slos = [{ id: 'latency', metric: 'http_req_duration', stat: 'p95', operator: '<', value: 10 }];
  const input = fixture(config); input.summary!.metrics.http_req_duration!.values.count = 0;
  threshold(input, 'http_req_duration', 'p(95)<10', ok);
  expect(mapK6Result(input)).toMatchObject({ ok: true, body: { outcome: 'inconclusive', completeness: 'partial', thresholds: [] } });
  input.process.exitCode = 99;
  expect(mapK6Result(input)).toMatchObject({ ok: true, body: { execution: { status: 'error', reason: 'engine_crash' } } });
});
it('does not treat a no-sample discovery boolean as a reached witness', () => {
  const input = fixture(discoveryConfig()); input.process.exitCode = 99;
  threshold(input, 'http_req_duration', 'p(95)<=10', false);
  input.summary!.metrics.http_req_duration!.values = {};
  expect(mapK6Result(input)).toMatchObject({ ok: true, body: { outcome: 'inconclusive', completeness: 'partial',
    expectedAbort: { ruleId: 'stop', reached: false }, thresholds: [] } });
});
it.each([['passes', 0, 'fails', 0], ['passes', null, 'fails', 1]] as const)(
  'requires a positive known Rate sample denominator (%s=%s,%s=%s)', (first, firstValue, second, secondValue) => {
    const config = configFor();
    config.loadPlan.slos = [{ id: 'errors', metric: 'http_req_failed', stat: 'rate', operator: '<', value: 0.1 }];
    const input = fixture(config); const values = input.summary!.metrics.http_req_failed!.values;
    if (firstValue === null) delete values[first]; else values[first] = firstValue;
    values[second] = secondValue;
    expect(mapK6Result(input)).toMatchObject({ ok: true, body: { outcome: 'inconclusive', completeness: 'partial', thresholds: [] } });
  });
it('retains a genuine zero Counter as supported decision evidence', () => {
  const config = configFor();
  config.loadPlan.slos = [{ id: 'none', metric: 'dropped_iterations', stat: 'count', operator: '<=', value: 0 }];
  const input = fixture(config);
  expect(mapK6Result(input)).toMatchObject({ ok: true, body: { outcome: 'passed', thresholds: [{ id: 'none', passed: true }] } });
});
it('requires the referenced native statistic even when Trend sample count is positive', () => {
  const config = configFor();
  config.loadPlan.slos = [{ id: 'latency', metric: 'http_req_duration', stat: 'p95', operator: '<', value: 10 }];
  const input = fixture(config); delete input.summary!.metrics.http_req_duration!.values['p(95)'];
  expect(mapK6Result(input)).toMatchObject({ ok: true, body: { outcome: 'inconclusive', completeness: 'partial' } });
});
it.each([true, false])('requires a known Gauge value (present=%s)', present => {
  const config = configFor();
  config.loadPlan.slos = [{ id: 'vus', metric: 'vus', stat: 'value', operator: '<=', value: 2 }];
  const input = fixture(config); if (!present) delete input.summary!.metrics.vus!.values.value;
  expect(mapK6Result(input)).toMatchObject({ ok: true, body: { outcome: present ? 'passed' : 'inconclusive',
    completeness: present ? 'complete' : 'partial' } });
});
it('requires Counter count support in addition to a native rate statistic', () => {
  const config = configFor();
  config.loadPlan.slos = [{ id: 'rate', metric: 'http_reqs', stat: 'rate', operator: '<=', value: 2 }];
  const input = fixture(config); delete input.summary!.metrics.http_reqs!.values.count;
  expect(mapK6Result(input)).toMatchObject({ ok: true, body: { outcome: 'inconclusive', completeness: 'partial' } });
});
it('uses the supported native Rate verdict without recomputing the comparison', () => {
  const config = configFor();
  config.loadPlan.slos = [{ id: 'errors', metric: 'http_req_failed', stat: 'rate', operator: '<', value: 0.1 }];
  const input = fixture(config); input.process.exitCode = 99;
  threshold(input, 'http_req_failed', 'rate<0.1', false);
  expect(mapK6Result(input)).toMatchObject({ ok: true, body: { outcome: 'failed', completeness: 'complete',
    thresholds: [{ id: 'errors', purpose: 'slo', passed: false }] } });
});
