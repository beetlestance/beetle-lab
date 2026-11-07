import { describe, expect, it } from 'vitest';
import { initialSelectionState, selectDatasetRows, selectRequest } from '../../plan/index.js';
import { compiled } from '../suite/fixtures.js';
import { configFor, harness } from './fixtures.js';

describe('global VU identity independent of scenario concurrency', () => {
  it.each([100_001, Number.MAX_SAFE_INTEGER])('selects with global VU identity%s using only bounded entry counters', vu => {
    const suite = compiled(configFor()); const plan = suite.selections[0]!;
    const initial = initialSelectionState(plan, vu);
    expect(initial.ok).toBe(true);
    if (!initial.ok) throw new Error('identity admission');
    expect(initial.value.counts).toEqual([0]);
    expect(selectRequest(plan, initial.value, () => 0)).toMatchObject({ ok: true,
      value: { state: { vu, iteration: 1, counts: [1] } } });
    const rows = selectDatasetRows(suite.datasets, { vu, iteration: 0 }, () => 0);
    expect(rows.ok && rows.value.find(row => row.datasetId === 'numbers')?.rowIndex).toBe((vu - 1) % 3);
  });
  it('executes concurrent scenarios with100000+1 VUs and independent scenario counters', () => {
    const config = configFor(); const scenario = config.loadPlan.scenarios[0]!;
    if (scenario.executor !== 'per-vu-iterations') throw new Error('fixture');
    scenario.vus = 100_000;
    config.loadPlan.scenarios.push({ ...scenario, id: 'other', name: 'other', vus: 1 });
    config.selections.push({ ...config.selections[0]!, scenarioId: 'other' });
    const test = harness(compiled(config));
    for (const scenarioId of ['main', 'other']) {
      expect(test.runtime.iterate({ scenarioId, vu: 100_001, iteration: 0, deadlineMs: 60_000 }).kind).toBe('completed');
    }
    expect(test.requests).toHaveLength(2);
    expect(test.requests.every(request => request.url.endsWith('/one?n=3'))).toBe(true);
    expect(test.runtime.iterate({ scenarioId: 'main', vu: 100_001, iteration: 0, deadlineMs: 60_000 }).code).toBe('selection');
  });
  it.each([0, -1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid global VU identity%s', vu => {
    const suite = compiled(configFor()); const plan = suite.selections[0]!;
    const rejected = { ok: false, issues: [{ path: '', code: 'selection' }] };
    expect(initialSelectionState(plan, vu)).toEqual(rejected);
    expect(selectRequest(plan, { scenarioId: 'main', vu, iteration: 0, counts: [0] }, () => 0)).toEqual(rejected);
    expect(selectDatasetRows(suite.datasets, { vu, iteration: 0 }, () => 0)).toEqual(rejected);
    const test = harness(suite);
    expect(test.runtime.iterate({ scenarioId: 'main', vu, iteration: 0, deadlineMs: 60_000 }).code).toBe('selection');
    expect(test.requests).toEqual([]);
  });
});
