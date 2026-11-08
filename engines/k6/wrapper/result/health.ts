import { measureStartedMetric } from '../../plan/index.js';
import type { K6ResultInput, HealthEvidence, AssertionEvidence } from './types.js';
import { counter, verdict } from './numeric.js';

function guard(input: K6ResultInput, metric: string): { count: number | null; known: boolean; contradictory: boolean } {
  const count = counter(input.summary, metric);
  const ok = verdict(input.summary, metric, 'count==0');
  return { count, known: count !== null && ok !== null,
    contradictory: count !== null && ok !== null && ok !== (count === 0) };
}
export function healthEvidence(input: K6ResultInput, assertions: AssertionEvidence): HealthEvidence {
  const required = guard(input, 'beetle_required_failures');
  const execution = guard(input, 'beetle_execution_failures');
  const mismatch = failureMismatch(required.count, assertions);
  return { required: required.count, execution: execution.count,
    requiredFailure: required.known && required.count !== null && required.count > 0 && !required.contradictory,
    complete: required.known && execution.known,
    contradictory: required.contradictory || execution.contradictory || mismatch };
}
function failureMismatch(required: number | null, assertions: AssertionEvidence): boolean {
  if (required === null) return false;
  if (assertions.knownFailureEvaluations > required) return true;
  return assertions.failureEvaluations !== null && required !== assertions.failureEvaluations;
}
export function measurementComplete(input: K6ResultInput): boolean {
  const snapshot = input.metrics;
  if (!snapshot || !snapshot.totalsComplete || snapshot.measurement.complete !== true) return false;
  const time = snapshot.measurement.sourceTimeMs;
  return Number.isSafeInteger(time) && time >= 0 && counter(input.summary, measureStartedMetric) === 1;
}
