import { describe, expect, it } from 'vitest';
import { clock, durationMs, planSummary, spoken } from './plan.js';
import { datasets, requestRows, targetOf, thresholds } from './details.js';
import { changeList } from './changes.js';
import { budgetSentence, fromFriendly, limitText, toFriendly } from './budget.js';
import { when } from './status.js';

const input = { id: '11111111-1111-4111-8111-111111111111', sha256: 'a'.repeat(64), bytes: 10 };
function config(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    target: 'http://user:secret@checkout-api:8080/base?x=1',
    requests: [
      { id: 'cart', name: 'Cart', method: 'POST', path: '/cart/items', query: {}, headers: {}, assertions: [
        { id: 'a', required: true, kind: 'statusEq', value: 201 },
        { id: 'b', required: true, kind: 'jsonExists', path: '$.cartId' },
      ], body: { kind: 'input', input, format: 'json' } },
      { id: 'health', name: 'Health', method: 'GET', path: '/health', query: {}, headers: {}, assertions: [
        { id: 'c', required: false, kind: 'statusFamily', value: 2 },
      ] },
    ],
    datasets: [{ id: 'users', selection: 'byVu', kind: 'csv', input }],
    secrets: [],
    loadPlan: {
      version: 1,
      scenarios: [
        { id: 'main', name: 'main', executor: 'ramping-arrival-rate', startTime: '0s', gracefulStop: '30s', startRate: 10,
          timeUnit: '1s', preAllocatedVUs: 120, maxVUs: 240,
          stages: [{ duration: '1m', target: 1200 }, { duration: '8m', target: 1200 }, { duration: '1m', target: 0 }] },
      ],
      slos: [
        { id: 'p95', metric: 'http_req_duration', stat: 'p95', operator: '<', value: 250 },
        { id: 'failed', metric: 'http_req_failed', stat: 'rate', operator: '<', value: 0.01 },
        { id: 'checks', metric: 'checks', stat: 'rate', operator: '>', value: 0.99 },
      ],
    },
    selections: [{ scenarioId: 'main', entries: [
      { requestId: 'cart', weight: 95, wait: { durationMs: 0, jitterMs: 0 } },
      { requestId: 'health', weight: 5, wait: { durationMs: 0, jitterMs: 0 } },
    ] }],
    ...overrides,
  };
}
describe('plan projection', () => {
  it('reads durations and formats clocks', () => {
    expect(durationMs('1m')).toBe(60_000);
    expect(durationMs('250ms')).toBe(250);
    expect(durationMs('1.5m')).toBeNull();
    expect(clock(600_000)).toBe('10:00');
    expect(clock(3_900_000)).toBe('1:05:00');
    expect(spoken(480_000)).toBe('8 min');
    expect(spoken(90_000)).toBe('90 s');
  });
  it('projects a ramping arrival-rate plan into stages, headline and total', () => {
    const plan = planSummary(config());
    expect(plan.totalMs).toBe(600_000);
    expect(plan.requestCount).toBe(2);
    expect(plan.first?.label).toBe('Ramping arrival rate');
    expect(plan.first?.stages.map((stage) => stage.label)).toEqual(['Ramp', 'Steady at 1,200 a second', 'Drain']);
    expect(plan.first?.headline).toBe(
      '10 → 1,200 a second over 1 min, hold 8 min, back down over 1 min; 120 to 240 VUs',
    );
  });
  it('returns unknown length rather than a guess for malformed or target-dependent plans', () => {
    expect(planSummary({ loadPlan: { scenarios: [{ executor: 'ramping-arrival-rate', startRate: 1, stages: [{ duration: 'soon', target: 3 }] }] } }).totalMs).toBeNull();
    expect(planSummary({ loadPlan: { scenarios: [{ executor: 'ramp-until', startRate: 1, maxRate: 9, timeUnit: '1s' }] } }).totalMs).toBeNull();
    expect(planSummary({}).first).toBeNull();
  });
  it('lists requests with shares, bodies and checks, thresholds, datasets and target origin only', () => {
    const rows = requestRows(config());
    expect(rows[0]).toMatchObject({ method: 'POST', path: '/cart/items', share: 95, body: { kind: 'input', inputId: input.id } });
    expect(rows[0]?.checks).toEqual(['status is 201', 'JSON path exists $.cartId']);
    expect(rows[1]).toMatchObject({ share: 5, body: { kind: 'none' }, checks: ['status family is 2xx'] });
    expect(thresholds(config())).toEqual(['p95 under 250 ms', 'failed requests under 1%', 'checks above 99%']);
    expect(datasets(config())).toEqual([{ id: 'users', source: { kind: 'input', inputId: input.id, format: 'csv' }, selection: 'one row per virtual user' }]);
    expect(targetOf(config())).toBe('http://checkout-api:8080');
  });
  it('describes revision changes in plain language', () => {
    const before = config();
    const scenarios = (before.loadPlan.scenarios as Record<string, unknown>[]).map((scenario) => ({
      ...scenario,
      stages: [{ duration: '1m', target: 1000 }, { duration: '8m', target: 1000 }, { duration: '1m', target: 0 }],
    }));
    const older = config({ loadPlan: { ...before.loadPlan, scenarios } });
    expect(changeList(older, before)).toEqual(['peak: 1,000 a second to 1,200 a second']);
    expect(changeList(before, config({ requests: [before.requests[0]] }))).toContain('removed request GET /health');
    expect(changeList(before, before)).toEqual([]);
  });
});
describe('budget and time copy', () => {
  it('converts friendly units both ways and names the limit', () => {
    expect(toFriendly('memoryBytes', 4 * 1024 ** 3)).toBe('4');
    expect(fromFriendly('cpuMillis', '1.5')).toBe('1500');
    expect(fromFriendly('timeoutMs', '30')).toBe('1800000');
    expect(fromFriendly('pids', 'abc')).toBe('abc');
    expect(limitText(1_800_000)).toBe('30-minute');
    expect(budgetSentence({ cpuMillis: 2000, memoryBytes: 4 * 1024 ** 3, pids: 512, outputBytes: 2 * 1024 ** 3, timeoutMs: 1 })).toBe(
      '2 CPUs, 4 GiB, 512 processes, 2 GiB output',
    );
  });
  it('says Today and Yesterday relative to now', () => {
    const now = new Date(2026, 10, 18, 23, 59);
    expect(when(new Date(2026, 10, 18, 23, 35).toISOString(), now)).toBe('Today, 23:35');
    expect(when(new Date(2026, 10, 17, 21, 30).toISOString(), now)).toBe('Yesterday, 21:30');
    expect(when(new Date(2026, 10, 14, 11, 40).toISOString(), now)).toBe('Nov 14, 11:40');
    expect(when('not a date', now)).toBe('Unknown time');
  });
});
