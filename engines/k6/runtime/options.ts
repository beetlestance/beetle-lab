import { counterNames, metricLayout } from '../plan/index.js';
import type { CompiledSuite, DeepReadonly, K6Threshold } from '../plan/index.js';
import { validateAttempt } from './attempt.js';
import type { AttemptBudget } from './attempt.js';

export function nativeThresholds(suite: DeepReadonly<CompiledSuite>): Record<string, K6Threshold[]> {
  const layout = metricLayout(suite);
  const thresholds: Record<string, K6Threshold[]> = Object.create(null) as Record<string, K6Threshold[]>;
  for (const [name, rules] of Object.entries(suite.loadPlan.options.thresholds)) thresholds[name] = rules.map(rule => ({ ...rule }));
  const observe = (key: string): void => { thresholds[key] = [{ threshold: 'count>=0', abortOnFail: false }]; };
  for (const name of counterNames) if (!thresholds[name]) observe(name);
  for (const request of [...layout.requests, ...(layout.readiness ? [layout.readiness] : [])]) {
    observe(`beetle_requests{request:${request.label}}`);
    for (const assertion of request.assertions) {
      observe(`beetle_assertions{assertion:${assertion.label}}`);
      observe(`beetle_assertion_failures{assertion:${assertion.label}}`);
    }
  }
  for (const name of ['beetle_required_failures', 'beetle_execution_failures']) thresholds[name]!.push({ threshold: 'count==0', abortOnFail: false });
  return thresholds;
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
