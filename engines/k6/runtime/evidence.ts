import type { DeepReadonly, MetricLayout } from '../plan/index.js';
import { evaluateAssertions } from './assertions.js';
import type { AssertionResult } from './assertions.js';
import type { HttpResponse, IterationResult, RuntimeAdapters, RuntimeLimits } from './types.js';
import type { AssertionPlan } from '../plan/index.js';

export function recordAssertions(input: { assertions: DeepReadonly<AssertionPlan[]>;
  labels: MetricLayout['requests'][number]['assertions']; response: HttpResponse;
  adapters: RuntimeAdapters; limits: RuntimeLimits }): AssertionResult[] {
  const results = evaluateAssertions(input.assertions, input.response, input.limits);
  results.forEach((result, index) => {
    const tags = { assertion: input.labels[index]!.label };
    input.adapters.metric('beetle_assertions', 1, tags);
    input.adapters.metric('beetle_assertion_failures', result.passed ? 0 : 1, tags);
  });
  return results;
}
export function recordOutcome(results: AssertionResult[], adapters: RuntimeAdapters): IterationResult {
  const requiredFailures = results.filter(result => result.required && !result.passed).length;
  const optionalFailures = results.filter(result => !result.required && !result.passed).length;
  adapters.metric('beetle_required_failures', requiredFailures, {});
  return { kind: requiredFailures ? 'assertion' : 'completed', requiredFailures, optionalFailures };
}
