import { encodeJson } from '@beetle/contracts';
import { validateApi } from '@beetle/contracts/api';
import type { RunPinReceipt } from '@beetle/contracts/api';
import { digestMutationIntent } from '../namespaces/index.js';
import type { IntentDigest } from '../namespaces/index.js';
import { immutableSnapshot, requireRule, sameScope, sameUuid } from '../../domain/namespaces/index.js';
import type { RunPinCommand, RunPinOperation, RunPinStore } from '../../ports/runs.js';
import { runSnapshot } from './response.js';

/** Capture a bounded pin intent; replay binds kind, run and request, never the clock. */
export function prepareRunPinCommand(operation: RunPinOperation, digest: IntentDigest): RunPinCommand {
  const copy = JSON.parse(encodeJson(operation, 4096)) as RunPinOperation & { intentDigest?: string };
  requireRule(Object.keys(copy).every((key) => ['kind', 'id', 'requestedAt', 'request', 'intentDigest'].includes(key)));
  requireRule(
    (copy.kind === 'pinRun' || copy.kind === 'unpinRun') &&
      validateApi('Uuid', copy.id).ok &&
      validateApi('RunTimestamp', copy.requestedAt).ok &&
      validateApi('RunPinRequest', copy.request).ok,
  );
  const { kind, id, requestedAt, request } = copy;
  const intentDigest = digestMutationIntent({ kind, id, request }, digest);
  requireRule(copy.intentDigest === undefined || copy.intentDigest === intentDigest);
  return immutableSnapshot({ kind, id, requestedAt, request, intentDigest });
}

/** One receipt answers exactly one captured command: run, scope, request and direction. */
export function checkedRunPinReceipt(input: unknown, command: RunPinCommand): RunPinReceipt {
  const checked = validateApi('RunPinReceipt', runSnapshot(input, 4096));
  if (!checked.ok) throw new Error('Invalid run pin receipt');
  const receipt = checked.value;
  if (
    !sameScope(receipt.scope, command.request.scope) ||
    !sameUuid(receipt.id, command.id) ||
    !sameUuid(receipt.requestId, command.request.requestId) ||
    receipt.pinned !== (command.kind === 'pinRun')
  )
    throw new Error('Invalid run pin receipt');
  return receipt;
}

/** Acceptance means the durable pin state matches the request; no optimistic state. */
export async function pinRun(input: {
  operation: RunPinOperation;
  digest: IntentDigest;
  store: RunPinStore;
}): Promise<RunPinReceipt> {
  const expected = prepareRunPinCommand(input.operation, input.digest);
  return checkedRunPinReceipt(await input.store.pin(runSnapshot(expected)), expected);
}
