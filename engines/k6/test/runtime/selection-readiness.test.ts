import { describe, expect, it } from 'vitest';
import { compiled } from '../suite/fixtures.js';
import { configFor, goodResponse, harness } from './fixtures.js';

describe('selection and preparation budgets', () => {
  it('uses the shared weighted selector, counters and inclusive jitter', () => {
    const config = configFor();
    config.selections[0]!.entries[0]!.maxIterationsPerVu = 2;
    config.selections[0]!.entries[0]!.wait = { durationMs: 10, jitterMs: 5 };
    const test = harness(compiled(config)); test.setRandom(0.999);
    expect(test.iterate(0).kind).toBe('completed'); expect(test.iterate(1).kind).toBe('completed');
    expect(test.sleeps).toEqual([15, 15]);
    expect(test.requests[0]!.url).toContain('/two?n=1'); expect(test.requests[0]!.headers['x-token']).toBe('t2');
    expect(test.iterate(2)).toMatchObject({ kind: 'execution', code: 'exhausted' });
    expect(test.requests).toHaveLength(2);
  });
  it('isolates instances and scenario counters and rejects mixed VUs/replayed iteration', () => {
    const config = configFor();
    config.loadPlan.scenarios.push({ ...config.loadPlan.scenarios[0]!, id: 'other', name: 'other' });
    config.selections.push({ ...config.selections[0]!, scenarioId: 'other' });
    const suite = compiled(config); const first = harness(suite); const second = harness(suite);
    expect(first.iterate().kind).toBe('completed'); expect(second.iterate().kind).toBe('completed');
    expect(first.runtime.iterate({ scenarioId: 'other', vu: 1, iteration: 0, deadlineMs: 60_000 }).kind).toBe('completed');
    expect(first.iterate().code).toBe('selection');
    expect(first.runtime.iterate({ scenarioId: 'main', vu: 2, iteration: 1, deadlineMs: 60_000 }).code).toBe('selection');
  });
  it('clamps HTTP timeout and wait to remaining accepted deadline', () => {
    const config = configFor(); config.selections[0]!.entries[0]!.wait.durationMs = 500;
    const test = harness(compiled(config)); test.iterate(0, 1123);
    expect(test.requests[0]!.timeoutMs).toBe(123); expect(test.sleeps).toEqual([123]);
    expect(test.iterate(1, 1123)).toMatchObject({ kind: 'execution', code: 'deadline' });
    expect(test.requests).toHaveLength(1);
  });
  it('rejects invalid injected randomness before HTTP', () => {
    const test = harness(); test.setRandom(1); expect(test.iterate().kind).toBe('execution'); expect(test.requests).toHaveLength(0);
  });
  it('readiness retries with no dataset selection and returns no setup data', () => {
    const test = harness(); let attempts = 0;
    test.adapters.random = () => { throw new Error('readiness must not select rows'); };
    test.adapters.http = request => { test.requests.push(request); attempts++; return { ...goodResponse, status: attempts === 3 ? 200 : 503 }; };
    expect(test.runtime.prepare(5000)).toBeUndefined();
    expect(test.requests.map(request => [request.method, request.url, request.timeoutMs])).toEqual(Array.from({ length: 3 }, () => ['GET', 'https://synthetic.invalid/api/health', 100]));
    expect(test.sleeps).toEqual([20, 20]);
    expect(test.metrics.filter(metric => metric.name === 'beetle_required_failures')).toHaveLength(0);
  });
  it('fails preparation on exhaustion, timeout, transport and caller deadline', () => {
    const test = harness(); test.setResponse({ ...goodResponse, status: 503 });
    expect(() => test.runtime.prepare(5000)).toThrow('preparation'); expect(test.requests).toHaveLength(3);
    const timeout = harness(); timeout.adapters.http = () => { timeout.setNow(1500); return goodResponse; };
    expect(() => timeout.runtime.prepare(1100)).toThrow('preparation');
    const deadline = harness(); expect(() => deadline.runtime.prepare(999)).toThrow('preparation'); expect(deadline.requests).toHaveLength(0);
    const transport = harness(); transport.adapters.http = () => { throw new Error('raw-canary'); };
    expect(() => transport.runtime.prepare(5000)).toThrow('preparation');
  });
  it('preserves the accepted 60s readiness timeout while using remaining time', () => {
    const config = configFor(); config.readiness = { ...config.readiness!, attempts: 1, timeoutMs: 60_000, wallBudgetMs: 60_000 };
    const test = harness(compiled(config)); test.runtime.prepare(61_000); expect(test.requests[0]!.timeoutMs).toBe(60_000);
    const clamped = harness(compiled(config)); clamped.runtime.prepare(2000); expect(clamped.requests[0]!.timeoutMs).toBe(1000);
  });
});
