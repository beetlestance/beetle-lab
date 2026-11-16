import type { EngineResult } from '@beetle/contracts';
import type { K6ResultInput, OrchestrationFailure } from './types.js';
type Execution = EngineResult['execution'];
type Reason = Extract<Execution, { status: 'error' }>['reason'];

const reasons: Readonly<Record<OrchestrationFailure, Reason>> = Object.freeze({
  cancelled: 'cancelled', deadline: 'timeout', clock: 'invalid_protocol', profile: 'setup_failed',
  build: 'setup_failed', native: 'engine_crash', closed: 'engine_crash',
  metrics: 'artifact_incomplete', summary: 'artifact_incomplete', cleanup: 'artifact_incomplete',
});
/** Mandatory private receipt fields; unknown reasons never enter protocol output. */
export function validOrchestration(input: K6ResultInput): boolean {
  const failure = input.orchestrationFailure;
  return typeof input.orchestrationQuiescent === 'boolean'
    && (failure === null || typeof failure === 'string' && Object.hasOwn(reasons, failure));
}
export function orchestrationExecution(input: K6ResultInput): Execution | null {
  const failure = input.orchestrationFailure;
  if (failure === null) return null;
  const observation = { exitCode: input.process.exitCode, stoppedAt: input.terminalObservedAt };
  return failure === 'cancelled' ? { ...observation, status: 'cancelled', reason: 'cancelled' }
    : { ...observation, status: 'error', reason: reasons[failure] };
}
