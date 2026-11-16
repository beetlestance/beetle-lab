import { describe, expect, it, vi } from 'vitest';
import { compiled } from '../suite/fixtures.js';
import { configFor, goodResponse, harness } from './fixtures.js';
import { evaluateAssertions } from '../../runtime/assertions.js';
import { defaultLimits } from '../../runtime/bounds.js';
import { responseJson } from '../../runtime/response-json.js';
import type { AssertionPlan } from '../../plan/index.js';

describe('native assertion evidence', () => {
  it('evaluates all ten closed assertion operators', () => {
    const assertions = compiled(configFor()).requests[0]!.assertions;
    expect(assertions).toHaveLength(10);
    expect(evaluateAssertions(assertions, goodResponse, defaultLimits).every(result => result.passed)).toBe(true);
    const bad = { status: 500, body: '{"count":0,"message":"no","users":[]}', headers: {}, transportFailed: false };
    expect(evaluateAssertions(assertions, bad, defaultLimits).every(result => !result.passed)).toBe(true);
  });
  it.each([['lt', 0, true], ['lte', 1, true], ['gt', 2, true], ['gte', 1, true], ['lt', 2, false]] as const)(
    'compares %s with numeric values', (operator, value, passed) => {
      const assertion: AssertionPlan = { id: 'compare', required: true, kind: 'jsonCompare', segments: ['n'], operator, value: 1 };
      expect(evaluateAssertions([assertion], { ...goodResponse, body: JSON.stringify({ n: value }) }, defaultLimits)[0]!.passed).toBe(passed);
    });
  it('keeps required failures separate from optional failures and transport', () => {
    const config = configFor();
    config.requests[0]!.assertions = [{ id: 'optional', required: false, kind: 'statusEq', value: 201 }];
    const optional = harness(compiled(config)); expect(optional.iterate()).toMatchObject({ kind: 'completed', optionalFailures: 1, requiredFailures: 0 });
    expect(optional.metrics).toContainEqual({ name: 'beetle_assertion_failures', value: 1, tags: { assertion: 'a0' } });
    config.requests[0]!.assertions[0]!.required = true;
    const required = harness(compiled(config)); expect(required.iterate()).toMatchObject({ kind: 'assertion', requiredFailures: 1 });
    expect(required.metrics).toContainEqual({ name: 'beetle_required_failures', value: 1, tags: {} });
    const transport = harness(compiled(config)); transport.setResponse({ ...goodResponse, status: 0, transportFailed: true });
    expect(transport.iterate()).toMatchObject({ kind: 'transport', requiredFailures: 0 });
    expect(transport.metrics.some(metric => metric.name === 'beetle_assertions')).toBe(false);
    const status = harness(compiled(config)); status.setResponse({ ...goodResponse, status: 500 });
    expect(status.iterate().kind).toBe('assertion');
  });
  it('contains unexpected adapter errors without returning request/error/secret values', () => {
    const test = harness();
    test.adapters.http = () => { throw new Error('private-response-and-secret-canary'); };
    const result = test.iterate(); expect(result.kind).toBe('transport');
    expect(JSON.stringify({ result, metrics: test.metrics })).not.toMatch(/private-response|synthetic-secret/);
    const metrics = harness(); metrics.adapters.metric = () => { throw new Error('private-metric-canary'); };
    expect(metrics.iterate()).toMatchObject({ kind: 'execution', code: 'adapter' });
    expect(() => metrics.runtime.prepare(5000)).toThrow('adapter');
  });
  it.each(['not json', '[', 'null', '{"users":null}'])('fails JSON checks safely for %j', body => {
    const assertion: AssertionPlan = { id: 'json', required: true, kind: 'jsonExists', segments: ['users', 0] };
    expect(evaluateAssertions([assertion], { ...goodResponse, body }, defaultLimits)[0]!.passed).toBe(false);
  });
  it('bounds UTF-8/body/node/depth processing before parsing and never truncates', () => {
    const parse = vi.spyOn(JSON, 'parse');
    expect(responseJson('"🙂"', { ...defaultLimits, responseProcessingBytes: 5 })).toEqual({ ok: false });
    expect(responseJson('[1,2]', { ...defaultLimits, responseJsonNodes: 2 })).toEqual({ ok: false });
    expect(responseJson('[[1]]', { ...defaultLimits, responseJsonDepth: 1 })).toEqual({ ok: false });
    expect(parse).not.toHaveBeenCalled(); parse.mockRestore();
    expect(responseJson('{"x":[1,2]}', { ...defaultLimits, responseJsonNodes: 4 })).toEqual({ ok: true, value: { x: [1, 2] } });
    const test = harness(undefined, { limits: { responseProcessingBytes: 8 } });
    expect(test.iterate().kind).toBe('assertion');
    expect(() => harness(undefined, { limits: { responseProcessingBytes: 8_388_609 } })).toThrow('invalid_limits');
  });
  it('requires own properties and refuses prototype segments even on altered IR', () => {
    for (const segments of [['constructor'], ['__proto__'], ['prototype'], ['missing']]) {
      const assertion: AssertionPlan = { id: 'own', required: true, kind: 'jsonExists', segments };
      expect(evaluateAssertions([assertion], { ...goodResponse, body: '{}' }, defaultLimits)[0]!.passed).toBe(false);
    }
    const own: AssertionPlan = { id: 'own', required: true, kind: 'jsonEquals', segments: ['nullable'], value: null };
    expect(evaluateAssertions([own], { ...goodResponse, body: '{"nullable":null}' }, defaultLimits)[0]!.passed).toBe(true);
  });
});
