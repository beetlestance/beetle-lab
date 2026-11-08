import { metricLayout, nativeMetricKey } from '../../plan/index.js';
import type { K6ResultInput, AssertionEvidence } from './types.js';
import { counter, sum } from './numeric.js';

interface Check { attempts: number | null; evaluations: number | null; failures: number | null }
function contradicts(check: Check): boolean {
  const { attempts, evaluations, failures } = check;
  return (evaluations !== null && attempts !== null && evaluations > attempts)
    || (failures !== null && evaluations !== null && failures > evaluations)
    || (failures !== null && attempts !== null && failures > attempts);
}
function classification(check: Check): 'passed' | 'failed' | 'unknown' {
  if (check.failures !== null && check.failures > 0) return 'failed';
  return check.attempts !== null && check.attempts > 0 && check.evaluations === check.attempts
    && check.failures === 0 ? 'passed' : 'unknown';
}
export function assertionEvidence(input: K6ResultInput): AssertionEvidence {
  const layout = metricLayout(input.suite);
  const counts = { required: 0, passed: 0, failed: 0, unknown: 0 };
  let allFailuresKnown = true;
  let knownFailureEvaluations = 0;
  let contradictory = false;
  for (const [index, request] of input.suite.requests.entries()) {
    const labels = layout.requests[index]!;
    const attempts = counter(input.summary, nativeMetricKey('beetle_requests', { request: labels.label }));
    for (const [checkIndex, assertion] of request.assertions.entries()) {
      if (!assertion.required) continue;
      const tags = { assertion: labels.assertions[checkIndex]!.label };
      const check: Check = { attempts, evaluations: counter(input.summary, nativeMetricKey('beetle_assertions', tags)),
        failures: counter(input.summary, nativeMetricKey('beetle_assertion_failures', tags)) };
      contradictory ||= contradicts(check);
      counts.required++; counts[classification(check)]++;
      if (check.failures === null) allFailuresKnown = false;
      else knownFailureEvaluations = sum(knownFailureEvaluations, check.failures);
    }
  }
  return { counts, failureEvaluations: allFailuresKnown ? knownFailureEvaluations : null, knownFailureEvaluations, contradictory };
}
