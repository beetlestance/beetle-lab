import { boundary, fail } from './failure.js';
import type { DatasetPlan, DeepReadonly, Result, Row, SelectionPlan } from './suite.js';
export interface SelectionState { scenarioId: string; vu: number; iteration: number; counts: readonly number[] }
export interface SelectionResult { requestId: string; waitMs: number; state: SelectionState }
export type Random = () => number;
function sample(random: Random): number {
  let value: number;
  try { value = random(); } catch { return fail('random'); }
  if (!Number.isFinite(value) || value < 0 || value >= 1) fail('random');
  return value;
}
function validPosition(vu: number, iteration: number): void {
  if (!Number.isSafeInteger(vu) || vu < 1 || vu > 100_000
    || !Number.isSafeInteger(iteration) || iteration < 0 || iteration > 1_000_000_000) fail('selection');
}
export function initialSelectionState(plan: DeepReadonly<SelectionPlan>, vu: number): Result<SelectionState> {
  return boundary(() => {
    validPosition(vu, 0);
    return { scenarioId: plan.scenarioId, vu, iteration: 0, counts: plan.entries.map(() => 0) };
  });
}
function eligible(plan: DeepReadonly<SelectionPlan>, state: SelectionState): { index: number; weight: number }[] {
  validPosition(state.vu, state.iteration);
  if (state.scenarioId !== plan.scenarioId || state.counts.length !== plan.entries.length) fail('selection');
  let sum = 0;
  const entries = plan.entries.flatMap((entry, index) => {
    const count = state.counts[index]!;
    if (!Number.isSafeInteger(count) || count < 0 || count > (entry.maxIterationsPerVu ?? 1_000_000_000)) fail('selection');
    sum += count;
    return count < (entry.maxIterationsPerVu ?? 1_000_000_000) ? [{ index, weight: entry.weight }] : [];
  });
  if (sum !== state.iteration) fail('selection');
  if (!entries.length || state.iteration === 1_000_000_000) fail('exhausted');
  return entries;
}
/** Per VU/scenario counters; weighted sampling then uniform integer jitter in [0,jitterMs]. */
export function selectRequest(plan: DeepReadonly<SelectionPlan>, state: SelectionState, random: Random): Result<SelectionResult> {
  return boundary(() => {
    const entries = eligible(plan, state);
    let remaining = sample(random) * entries.reduce((sum, entry) => sum + entry.weight, 0);
    const selected = entries.find(entry => { remaining -= entry.weight; return remaining < 0; });
    if (!selected) fail('selection');
    const entry = plan.entries[selected.index]!;
    const waitMs = entry.wait.durationMs + (entry.wait.jitterMs ? Math.floor(sample(random) * (entry.wait.jitterMs + 1)) : 0);
    const counts = [...state.counts]; counts[selected.index] = counts[selected.index]! + 1;
    return { requestId: entry.requestId, waitMs, state: { ...state, iteration: state.iteration + 1, counts } };
  });
}
/** Select exactly once at iteration entry and retain these rows for every template in the iteration. */
export function selectDatasetRows(datasets: DeepReadonly<DatasetPlan[]>, position: { vu: number; iteration: number }, random: Random): Result<readonly { datasetId: string; rowIndex: number; row: Row }[]> {
  return boundary(() => {
    validPosition(position.vu, position.iteration);
    return datasets.map(dataset => {
      if (!dataset.rows.length) fail('dataset');
      const rowIndex = dataset.selection === 'byVu' ? (position.vu - 1) % dataset.rows.length
        : Math.floor(sample(random) * dataset.rows.length);
      return { datasetId: dataset.id, rowIndex, row: dataset.rows[rowIndex]! };
    });
  });
}
