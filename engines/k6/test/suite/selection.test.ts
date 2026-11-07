import { describe, expect, it } from 'vitest';
import { initialSelectionState, selectRequest } from '../../compiler/suite/index.js';
import type { SelectionState } from '../../compiler/suite/index.js';
import { validateAndCompileSuite } from '../../compiler/suite/validation.js';
import { compiled, dependencies, fixture } from './fixtures.js';
describe('deterministic per-VU request selector', () => {
  it('applies weights and uniform inclusive integer jitter from injected samples', () => {
    const plan = compiled().selections[0]!;
    const initial = initialSelectionState(plan, 1); if (!initial.ok) throw new Error('fixture');
    const state = initial.value;
    const low = selectRequest(plan, state, () => 0);
    expect(low.ok && low.value).toMatchObject({ requestId: 'get', waitMs: 10, state: { iteration: 1, counts: [1, 0] } });
    let calls = 0;
    const highJitter = selectRequest(plan, state, () => calls++ === 0 ? 0 : 0.999);
    expect(highJitter.ok && highJitter.value.waitMs).toBe(15);
    expect(selectRequest(plan, state, () => 0.25)).toMatchObject({ ok: true, value: { requestId: 'post', waitMs: 0 } });
    expect(state.counts).toEqual([0, 0]);
  });
  it('exhausts per-VU counters, excludes exhausted endpoints and isolates VUs', () => {
    const plan = compiled().selections[0]!; let state: SelectionState = { scenarioId: 'main', vu: 1, iteration: 0, counts: [0, 0] };
    const selected: string[] = [];
    for (let index = 0; index < 3; index++) {
      const result = selectRequest(plan, state, () => 0);
      if (!result.ok) throw new Error('unexpected exhaustion');
      state = result.value.state; selected.push(result.value.requestId);
    }
    expect(selected).toEqual(['get', 'get', 'post']);
    expect(selectRequest(plan, state, () => 0)).toEqual({ ok: false, issues: [{ path: '', code: 'exhausted' }] });
    const other = initialSelectionState(plan, 2);
    expect(other.ok && selectRequest(plan, other.value, () => 0)).toMatchObject({ ok: true, value: { requestId: 'get' } });
  });
  it('rejects wrong scope, invalid counters and random values', () => {
    const plan = compiled().selections[0]!; const base = { scenarioId: 'main', vu: 1, iteration: 0, counts: [0, 0] };
    for (const patch of [{ scenarioId: 'other' }, { vu: 0 }, { iteration: NaN }, { counts: [] }, { counts: [-1, 0] }, { counts: [0.5, 0] }, { counts: [3, 0], iteration: 3 }, { iteration: 1 }]) {
      expect(selectRequest(plan, { ...base, ...patch }, () => 0).ok).toBe(false);
    }
    for (const value of [NaN, Infinity, -1, 1]) expect(selectRequest(plan, base, () => value).ok).toBe(false);
    expect(initialSelectionState(plan, 0).ok).toBe(false);
    expect(selectRequest(plan, base, () => { throw new Error('PRIVATE_CANARY'); })).toEqual({ ok: false, issues: [{ path: '', code: 'random' }] });
    const uncapped = { scenarioId: 'main', entries: plan.entries.map(({ requestId, weight, wait }) => ({ requestId, weight, wait })) };
    expect(selectRequest(uncapped, { ...base, iteration: 1_000_000_000, counts: [500_000_000, 500_000_000] }, () => 0)).toEqual({ ok: false, issues: [{ path: '', code: 'exhausted' }] });
  });
  it('rejects missing/conflicting scenarios, unknown/duplicate request entries and impossible weights', () => {
    const variants = [
      (config: ReturnType<typeof fixture>) => { config.selections = []; },
      (config: ReturnType<typeof fixture>) => { config.selections[0]!.scenarioId = 'unknown'; },
      (config: ReturnType<typeof fixture>) => { config.selections.push(config.selections[0]!); },
      (config: ReturnType<typeof fixture>) => { config.selections[0]!.entries[0]!.requestId = 'unknown'; },
      (config: ReturnType<typeof fixture>) => { config.selections[0]!.entries.push(config.selections[0]!.entries[0]!); },
      (config: ReturnType<typeof fixture>) => { config.selections[0]!.entries[0]!.weight = 0; },
      (config: ReturnType<typeof fixture>) => { config.selections[0]!.entries[0]!.wait.jitterMs = -1; },
    ];
    for (const mutate of variants) { const config = fixture(); mutate(config); expect(validateAndCompileSuite(config, dependencies()).ok).toBe(false); }
  });
});
