import { metricEvidenceLayout } from '../plan/index.js';
import type { CompiledSuite, DeepReadonly, K6Threshold } from '../plan/index.js';
import { validateAttempt } from './attempt.js';
import type { AttemptBudget } from './attempt.js';

export function nativeThresholds(suite: DeepReadonly<CompiledSuite>): Record<string, K6Threshold[]> {
  return Object.fromEntries(Object.entries(metricEvidenceLayout(suite).thresholds)
    .map(([key, rules]) => [key, rules.map(rule => ({ ...rule }))]));
}
export function nativeOptions(suite: DeepReadonly<CompiledSuite>, attempt: AttemptBudget): {
  scenarios: DeepReadonly<CompiledSuite>['loadPlan']['options']['scenarios'];
  thresholds: Record<string, K6Threshold[]>; systemTags: string[]; discardResponseBodies: boolean;
  throw: boolean; maxRedirects: number; setupTimeout: string; summaryTrendStats: string[];
} {
  const budget = validateAttempt(attempt);
  return { scenarios: suite.loadPlan.options.scenarios, thresholds: nativeThresholds(suite), systemTags: [], discardResponseBodies: true,
    throw: true, maxRedirects: 0, setupTimeout: `${Math.min(budget.timeoutMs, suite.readiness?.wallBudgetMs ?? 1000)}ms`,
    summaryTrendStats: ['avg', 'min', 'max', 'med', 'p(50)', 'p(90)', 'p(95)', 'p(99)', 'count'] };
}
