import { describe, expect, it } from 'vitest';
import { parseDraft, starter } from '../suites/draft.js';
import { clock, loadShape, rampHoldDrain, seconds, setRampHoldDrain, switchExecutor } from './load.js';
import { addRequest, removeRequest, uniqueId, weightOf } from './model.js';
import { validate } from './problems.js';
import { checkLabel, shownValue, storedValue } from './rules.js';

describe('suite editor model', () => {
  it('adds and removes requests together with their selection entries', () => {
    const added = addRequest(parseDraft(starter()));
    const requests = added.requests as { id: string }[];
    expect(requests.map((request) => request.id)).toEqual(['get', 'request']);
    expect(weightOf(added, 'request')).toBe(1);
    const removed = removeRequest(added, 1);
    expect(weightOf(removed, 'request')).toBeUndefined();
    expect(uniqueId('users.csv', ['users'])).toBe('users_2');
    expect(uniqueId('9lives', [])).toBe('_9lives');
  });

  it('reads durations, shapes ramps and keeps the ramp above its drain', () => {
    expect(seconds('2m')).toBe(120);
    expect(seconds('1.5s')).toBeUndefined();
    expect(clock(600)).toBe('10:00');
    const scenario = switchExecutor({ id: 'main', executor: 'per-vu-iterations', iterations: 1, vus: 1 }, 'ramping-arrival-rate');
    expect(rampHoldDrain(scenario)).toEqual({ peak: 10, ramp: 60, hold: 480, drain: 60, end: 1 });
    const longer = setRampHoldDrain(scenario, 'hold', 900);
    expect(loadShape(longer)?.total).toBe(1020);
  });

  it('stores percent thresholds as a rate and labels checks', () => {
    const rule = { metric: 'http_req_failed', stat: 'rate', operator: '<', value: 0 };
    expect(storedValue(rule, '1')).toBe(0.01);
    expect(shownValue({ ...rule, value: 0.015 })).toBe('1.5');
    expect(storedValue(rule, '1e3')).toBe('1e3');
    expect(checkLabel({ kind: 'statusEq', value: 201 })).toBe('status is 201');
  });

  it('names blocking problems by request', () => {
    const config = parseDraft(starter());
    const requests = config.requests as Record<string, unknown>[];
    const broken = { ...config, requests: [{ ...requests[0], path: 'no-slash' }] };
    expect(validate(broken)).toEqual([{ path: '/requests/0/path', message: 'Request 1 path must start with /.' }]);
    expect(validate(config)).toEqual([]);
  });
});
