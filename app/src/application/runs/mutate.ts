import type { Run } from '@beetle/contracts/api';
import type { IntentDigest } from '../namespaces/index.js';
import { requireRule, sameScope, sameUuid } from '../../domain/namespaces/index.js';
import type { CreateRunOperation, RunStore } from '../../ports/runs.js';
import { prepareRunCommand } from './intent.js';
import { checkedRun, runSnapshot } from './response.js';

function initialReceipt(value: Run): boolean {
  return value.version === 1 && value.state === 'queued' && value.validationStatus === 'pending'
    && !value.cancellationRequested && value.reason === null;
}

/** A receipt replay binds client intent, not this call's fresh IDs or clock. */
export async function enqueueRun(input: {
  operation: CreateRunOperation; digest: IntentDigest; store: RunStore;
}): Promise<Run> {
  const expected = prepareRunCommand(input.operation, input.digest);
  const value = checkedRun(await input.store.execute(runSnapshot(expected)));
  const request = expected.request;
  requireRule(sameScope(value.scope, request.scope), 'not_found');
  const budgetMatches = Object.entries(request.budget)
    .every(([key, amount]) => value.budget[key as keyof Run['budget']] === amount);
  if (!sameUuid(value.revisionId, request.revisionId) || value.engine.profileId !== request.engineProfile
    || !budgetMatches || value.executionPolicy.mode !== request.executionPolicy.mode
    || value.executionPolicy.preferIdle !== request.executionPolicy.preferIdle
    || !initialReceipt(value)) throw new Error('Invalid run receipt response');
  return value;
}
