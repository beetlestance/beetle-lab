import type { ApiOperation } from '../generated/operations.js';
import type { CreateRunRequest, Run, RunPage } from '../generated/types.js';
import type { PreparedInput } from './input.js';

function validRun(run: Run): boolean {
  if (run.state === 'finished') return ['passed', 'failed', 'inconclusive'].includes(run.outcome)
    && run.validationStatus === 'passed' && run.reason === null;
  if (run.state === 'cancelled') return run.outcome === 'inconclusive'
    && run.cancellationRequested && run.reason === 'cancelled';
  if (run.state === 'errored') return run.outcome === 'inconclusive' && run.reason !== null;
  return run.outcome === 'pending';
}
function creationMatches(input: PreparedInput, run: Run): boolean {
  const body = input.body as CreateRunRequest;
  return run.revisionId.toLowerCase() === body.revisionId.toLowerCase()
    && run.engine.profileId === body.engineProfile
    && Object.entries(body.budget).every(([key, value]) => run.budget[key as keyof Run['budget']] === value)
    && run.executionPolicy.mode === body.executionPolicy.mode
    && run.executionPolicy.preferIdle === body.executionPolicy.preferIdle
    && run.version === 1 && run.state === 'queued' && run.validationStatus === 'pending'
    && !run.cancellationRequested && run.reason === null;
}
/** Common route/scope and schema checks run before these execution-intent bindings. */
export function runOwnership(operation: ApiOperation, input: PreparedInput, value: unknown): boolean {
  if (operation.response === 'RunPage') return (value as RunPage).items.every(validRun);
  if (operation.response !== 'Run') return true;
  const run = value as Run;
  return validRun(run) && (operation.name !== 'createRun' || creationMatches(input, run));
}
