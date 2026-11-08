import type { EngineResult } from '@beetle/contracts';
import type { AssertionEvidence, HealthEvidence, K6ResultInput, ThresholdEvidence } from './types.js';
type Execution = EngineResult['execution'];
type Reason = Extract<Execution, { status: 'error' }>['reason'];

export function sealable(input: K6ResultInput): boolean {
  const source = input.process;
  if (!source.quiescent) return false;
  if (!source.spawned) return source.state === 'not_started';
  return source.state === 'stopped' && source.groupAbsent && source.stdioClosed;
}
function causeReason(input: K6ResultInput): Reason | null {
  switch (input.process.cause) {
    case null: return null;
    case 'deadline': return 'timeout';
    case 'profile': case 'spawn': return 'setup_failed';
    case 'metric_limit': case 'diagnostic_limit': return 'output_limit';
    case 'stream': case 'sink': return 'artifact_incomplete';
    case 'clock': return 'invalid_protocol';
    default: return 'engine_crash';
  }
}
export function execution(input: K6ResultInput, health: HealthEvidence, contradictory: boolean,
  thresholds: ThresholdEvidence): Execution {
  const observation = { exitCode: input.process.exitCode, stoppedAt: input.terminalObservedAt };
  if (input.process.cause === 'cancelled') return { ...observation, status: 'cancelled', reason: 'cancelled' };
  const reason = errorReason(input, health, contradictory, thresholds);
  return reason ? { ...observation, status: 'error', reason } : { ...observation, status: 'completed' };
}
function errorReason(input: K6ResultInput, health: HealthEvidence, contradictory: boolean,
  thresholds: ThresholdEvidence): Reason | null {
  if (contradictory) return 'invalid_protocol';
  if (health.execution !== null && health.execution > 0) return 'engine_crash';
  const cause = causeReason(input);
  if (cause) return cause;
  if (!input.process.spawned || input.process.signal !== null) return 'engine_crash';
  return exitReason(input, health, thresholds);
}
function exitReason(input: K6ResultInput, health: HealthEvidence, thresholds: ThresholdEvidence): Reason | null {
  const code = input.process.exitCode;
  if (code === 0) return null;
  const explained = thresholds.verdicts.some(item => !item.passed) || health.requiredFailure;
  return code === 99 && explained ? null : 'engine_crash';
}
export function outcome(input: { execution: Execution; assertions: AssertionEvidence; thresholds: ThresholdEvidence; health: HealthEvidence;
  complete: boolean }): EngineResult['outcome'] {
  if (input.execution.status !== 'completed') return 'inconclusive';
  if (input.assertions.counts.failed > 0 || input.health.requiredFailure || input.thresholds.sloFailed) return 'failed';
  if (!input.complete) return 'inconclusive';
  const discovery = input.thresholds.expectedAbort;
  if (discovery) return discovery.reached && input.execution.exitCode === 99 ? 'passed' : 'inconclusive';
  return input.execution.exitCode === 0 ? 'passed' : 'inconclusive';
}
