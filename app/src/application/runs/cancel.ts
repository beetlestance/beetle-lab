import { encodeJson } from '@beetle/contracts';
import { validateApi } from '@beetle/contracts/api';
import type { Run } from '@beetle/contracts/api';
import { digestMutationIntent } from '../namespaces/index.js';
import type { IntentDigest } from '../namespaces/index.js';
import { immutableSnapshot, requireRule, sameScope, sameUuid } from '../../domain/namespaces/index.js';
import type { CancelRunCommand, CancelRunOperation, RunCancellationStore } from '../../ports/runs.js';
import { checkedRun, runSnapshot } from './response.js';

/** Capture a bounded monotonic intent; receipt replay binds the run, never a clock. */
export function prepareCancelRunCommand(operation: CancelRunOperation, digest: IntentDigest): CancelRunCommand {
  const copy = JSON.parse(encodeJson(operation, 65536)) as CancelRunOperation & { intentDigest?: string };
  requireRule(Object.keys(copy).every(key => ['kind', 'id', 'request', 'intentDigest'].includes(key)));
  requireRule(copy.kind === 'cancelRun' && validateApi('Uuid', copy.id).ok
    && validateApi('CancelRunRequest', copy.request).ok);
  const { kind, id, request } = copy;
  const intentDigest = digestMutationIntent({ kind, id, request }, digest);
  requireRule(copy.intentDigest === undefined || copy.intentDigest === intentDigest);
  const command = { kind, id, request, intentDigest };
  encodeJson(command, 65536);
  return immutableSnapshot(command);
}

/** Acceptance means durable intent or an already terminal run, not confirmed stop. */
export async function cancelRun(input: {
  operation: CancelRunOperation; digest: IntentDigest; store: RunCancellationStore;
}): Promise<Run> {
  const expected = prepareCancelRunCommand(input.operation, input.digest);
  const value = checkedRun(await input.store.cancel(runSnapshot(expected)));
  requireRule(sameScope(value.scope, expected.request.scope) && sameUuid(value.id, expected.id), 'not_found');
  if (!value.cancellationRequested && !['finished', 'cancelled', 'errored'].includes(value.state)) {
    throw new Error('Invalid run cancellation receipt');
  }
  return value;
}
