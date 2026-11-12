import {runListPageMatches} from '../run-list-page.js';
import type {RunListQuery} from '../generated/types.js';
import type { ApiOperation } from '../generated/operations.js';
import type { CreateRunRequest, Run, RunPage, RunResultSnapshot } from '../generated/types.js';
import type { PreparedInput } from './input.js';
import { encodeJson } from '../../json.js';

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
  if (operation.response === 'RunResultSnapshot') return resultMatches(value as RunResultSnapshot);
  if (operation.response === 'RunPage') return (value as RunPage).items.every(validRun)
    &&runListPageMatches(value as RunPage,{kind:'workspace',organizationId:input.params.organizationId!,workspaceId:input.params.workspaceId!},input.query as RunListQuery);
  if (operation.response !== 'Run') return true;
  const run = value as Run;
  const cancellationMatches = operation.name !== 'cancelRun' || run.cancellationRequested
    || ['finished', 'cancelled', 'errored'].includes(run.state);
  return cancellationMatches && validRun(run) && (operation.name !== 'createRun' || creationMatches(input, run));
}

function resultMatches(value: RunResultSnapshot): boolean {
  try { encodeJson(value, 73728); } catch { return false; }
  const result = value.result;
  return result === null || (result.generation === 1
    && result.attemptId.toLowerCase() === value.activeAttemptId.toLowerCase()
    && result.organizationId.toLowerCase() === value.scope.organizationId.toLowerCase()
    && result.workspaceId.toLowerCase() === value.scope.workspaceId.toLowerCase());
}
