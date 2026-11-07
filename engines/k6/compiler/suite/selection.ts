import { fail } from './failure.js';
import type { SelectionPlan, ValidatedSuiteConfig } from './types.js';
export { initialSelectionState, selectRequest, selectDatasetRows } from '../../plan/index.js';
export type { SelectionState, SelectionResult, Random } from '../../plan/index.js';
export function compileSelections(config: ValidatedSuiteConfig): SelectionPlan[] {
  const seen = new Set<string>();
  const scenarios = new Set(config.loadPlan.scenarios.map(scenario => scenario.id));
  const requests = new Set(config.requests.map(request => request.id));
  const selections = config.selections.map(selection => {
    if (!scenarios.has(selection.scenarioId) || seen.has(selection.scenarioId)) fail('selection', '/selections');
    seen.add(selection.scenarioId);
    const ids = new Set<string>();
    for (const entry of selection.entries) {
      if (!requests.has(entry.requestId) || ids.has(entry.requestId)) fail('selection', '/selections');
      ids.add(entry.requestId);
    }
    return { scenarioId: selection.scenarioId, entries: selection.entries.map(entry => ({ ...entry, wait: { ...entry.wait } })) };
  });
  if (seen.size !== scenarios.size) fail('selection', '/selections');
  return selections;
}
