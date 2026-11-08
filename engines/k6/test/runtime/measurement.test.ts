import { expect, it } from 'vitest';
import { counterNames, measureStartedMetric, metricDefinitions } from '../../plan/index.js';
import { nativeOptions } from '../../runtime/options.js';
import { nativeThresholds } from '../../runtime/index.js';
import { summaryProjection } from '../../runtime/summary.js';
import { validateAndCompileSuite } from '../../compiler/suite/validation.js';
import { compiled, dependencies } from '../suite/fixtures.js';
import { configFor, goodResponse, harness } from './fixtures.js';

it('emits one untagged marker only after successful readiness, before iterations', () => {
  const test = harness();
  const order: string[] = [];
  const metric = test.adapters.metric;
  test.adapters.http = request => { order.push('http:' + request.label); return goodResponse; };
  test.adapters.metric = (name, value, tags) => { order.push(name); metric(name, value, tags); };
  test.runtime.prepare(5000);
  const marker = test.metrics.filter(value => value.name === measureStartedMetric);
  expect(marker).toEqual([{ name: measureStartedMetric, value: 1, tags: {} }]);
  expect(order.indexOf(measureStartedMetric)).toBeGreaterThan(order.findIndex(value => value.startsWith('http:')));
  test.iterate();
  expect(test.metrics.filter(value => value.name === measureStartedMetric)).toHaveLength(1);
  expect(order.indexOf(measureStartedMetric)).toBeLessThan(order.lastIndexOf('http:r0'));
});
it('emits the same marker without readiness and does not make a setup HTTP request', () => {
  const config = configFor(); delete config.readiness;
  const test = harness(compiled(config)); test.runtime.prepare(5000);
  expect(test.requests).toHaveLength(0);
  expect(test.metrics).toEqual([{ name: measureStartedMetric, value: 1, tags: {} }]);
});
it('never repeats readiness or the marker on a reused setup instance', () => {
  const test = harness(); test.runtime.prepare(5000);
  const requests = test.requests.length;
  expect(() => test.runtime.prepare(5000)).toThrow('preparation');
  expect(test.requests).toHaveLength(requests);
  expect(test.metrics.filter(value => value.name === measureStartedMetric)).toHaveLength(1);
});
it('does not emit the marker after readiness failure or deadline exhaustion', () => {
  const failure = harness(); failure.setResponse({ status: 503, headers: {}, body: null, transportFailed: false });
  expect(() => failure.runtime.prepare(5000)).toThrow('preparation');
  expect(failure.metrics.some(value => value.name === measureStartedMetric)).toBe(false);
  const elapsed = harness();
  elapsed.adapters.http = () => { elapsed.setNow(2000); return goodResponse; };
  expect(() => elapsed.runtime.prepare(2000)).toThrow('preparation');
  expect(elapsed.metrics.some(value => value.name === measureStartedMetric)).toBe(false);
});
it('fails setup when the marker sink rejects, with no implicit readiness success', () => {
  const test = harness(); const metric = test.adapters.metric;
  test.adapters.metric = (name, value, tags) => {
    if (name === measureStartedMetric) throw new Error('PRIVATE_MARKER_FAILURE');
    metric(name, value, tags);
  };
  expect(() => test.runtime.prepare(5000)).toThrow('adapter');
  expect(test.metrics.some(value => value.name === measureStartedMetric)).toBe(false);
  expect(test.metrics).toContainEqual({ name: 'beetle_execution_failures', value: 1, tags: {} });
});
it('reserves the marker from user threshold rules and keeps its missing evidence unknown', () => {
  const config = configFor();
  config.loadPlan.slos = [{ id: 'control', metric: measureStartedMetric, stat: 'count', operator: '>=', value: 1 }];
  expect(validateAndCompileSuite(config, dependencies())).toMatchObject({ ok: false, issues: [{ code: 'metric' }] });
  const suite = compiled(configFor());
  expect(nativeOptions(suite, { mode: 'standalone', timeoutMs: 1000 }).thresholds[measureStartedMetric])
    .toEqual([{ threshold: 'count>=0', abortOnFail: false }]);
  expect(nativeThresholds(suite)).toEqual(nativeOptions(suite, { mode: 'standalone', timeoutMs: 1000 }).thresholds);
  expect(JSON.parse(summaryProjection(suite, { metrics: {} })).metrics[measureStartedMetric])
    .toEqual({ values: {}, thresholds: [{ expression: 'count>=0', ok: null }] });
});
it('shares an immutable unique metric catalogue between summary and wrapper admission', () => {
  expect(Object.isFrozen(metricDefinitions)).toBe(true);
  expect(metricDefinitions.every(Object.isFrozen)).toBe(true);
  expect(new Set(metricDefinitions.map(metric => metric.name)).size).toBe(metricDefinitions.length);
  for (const name of counterNames) expect(metricDefinitions).toContainEqual({ name, kind: 'counter' });
  const output = JSON.parse(summaryProjection(compiled(configFor()), { metrics: {} })) as { metrics: Record<string, unknown> };
  for (const { name } of metricDefinitions) expect(output.metrics).toHaveProperty(name);
});
