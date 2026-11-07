import { analyzeLoadPlan } from './analysis.js';
import { compileScenario } from './scenarios.js';
import { compileThresholds } from './thresholds.js';
import type { Checked, CompiledLoadPlan, K6Scenario, ValidatedLoadPlan } from './types.js';
export type * from './types.js';

/** Pure transform of a structurally validated load-plan component, never a runnable suite. */
export function compileLoadPlan(plan: ValidatedLoadPlan): Checked<CompiledLoadPlan> {
  const analysis = analyzeLoadPlan(plan);
  if (!analysis.ok) return analysis;
  const scenarios: Record<string, K6Scenario> = Object.create(null) as Record<string, K6Scenario>;
  plan.scenarios.forEach((scenario, index) => { scenarios[scenario.name] = compileScenario(scenario, index); });
  const thresholds = compileThresholds(plan);
  return { ok: true, value: { component: 'k6-load-plan', version: plan.version,
    options: { scenarios, thresholds: thresholds.options },
    execution: { upperBoundMs: Math.max(...analysis.value.map(item => item.upperBoundMs)), scenarios: analysis.value },
    thresholds: thresholds.rules, discovery: thresholds.discovery } };
}
