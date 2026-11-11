import { expect, it } from 'vitest';
import { k6MetricCatalogue, k6MetricLayout, metricDefinitions, counterNames } from './index.js';
function shape() {
  return {requests: [{id: 'first', assertions: [{id: 'status'}, {id: 'body'}]}, {id: 'second', assertions: [{id: 'other'}]}],
    readiness: {assertions: [{id: 'ready'}]}};
}
it('assigns stable labels across requests, assertions and readiness with detached immutable output', () => {
  const source = shape(); const layout = k6MetricLayout(source);
  expect(layout).toEqual({requests: [{id: 'first', label: 'r0', assertions: [{id: 'status', label: 'a0'}, {id: 'body', label: 'a1'}]},
    {id: 'second', label: 'r1', assertions: [{id: 'other', label: 'a2'}]}], readiness: {label: 'r2', assertions: [{id: 'ready', label: 'a3'}]}, labelSets: 8});
  source.requests[0]!.assertions[0]!.id = 'changed'; expect(layout.requests[0]?.assertions[0]?.id).toBe('status');
  expect(Object.isFrozen(layout.requests[0]?.assertions)).toBe(true); expect(Object.isFrozen(layout.requests)).toBe(true);
  expect(Object.isFrozen(metricDefinitions)).toBe(true); expect(Object.isFrozen(counterNames)).toBe(true);
});
it('preserves preparation, execution, engine and control catalogue identities and order', () => {
  const rows = k6MetricCatalogue(k6MetricLayout(shape()));
  expect(rows[0]).toEqual({metric: 'http_req_duration', kind: 'trend', scope: 'execute', tags: {phase: 'execute', request: 'r0'}});
  expect(rows).toContainEqual({metric: 'http_req_duration', kind: 'trend', scope: 'prepare', tags: {phase: 'prepare', request: 'r2'}});
  expect(rows).toContainEqual({metric: 'beetle_assertions', kind: 'counter', scope: 'execute', tags: {phase: 'execute', assertion: 'a2'}});
  expect(rows).toContainEqual({metric: 'beetle_execution_failures', kind: 'counter', scope: 'engine', tags: {phase: 'execute'}});
  expect(rows).toContainEqual({metric: 'beetle_measure_started', kind: 'counter', scope: 'control', tags: {}});
  expect(Object.isFrozen(rows[0]?.tags)).toBe(true);
});
it('admits exactly 200 label sets and refuses excess before constructing an unbounded catalogue', () => {
  const source = {requests: [{id: 'one', assertions: Array.from({length: 198}, (_, index) => ({id: `a${index}`}))}]};
  expect(k6MetricLayout(source).labelSets).toBe(200);
  source.requests[0]!.assertions.push({id: 'overflow'}); expect(() => k6MetricLayout(source)).toThrow();
  expect(() => k6MetricLayout({requests: Array.from({length: 200}, (_, index) => ({id: `r${index}`, assertions: []}))})).toThrow();
});
it('rejects a forged layout without touching its untrusted fields', () => {
  let touched = false; const valid = k6MetricLayout(shape());
  const forged = new Proxy(valid, {get() {touched = true; throw new Error('unexpected field access');}});
  expect(() => k6MetricCatalogue(forged)).toThrow(); expect(touched).toBe(false);
});
