import { encodeJson } from '@beetle/contracts';
import { validateApi } from '@beetle/contracts/api';
import { digestMutationIntent } from '../namespaces/index.js';
import type { IntentDigest } from '../namespaces/index.js';
import { immutableSnapshot, requireRule, sameUuid } from '../../domain/namespaces/index.js';
import type { CreateRunOperation, RunCommand } from '../../ports/runs.js';

/** Allocation identities and wall time do not change a replayed logical request. */
export function prepareRunCommand(operation: CreateRunOperation, digest: IntentDigest): RunCommand {
  const copy = JSON.parse(encodeJson(operation, 65536)) as CreateRunOperation & { intentDigest?: string };
  const fields = ['kind', 'id', 'attemptId', 'requestedAt', 'request', 'intentDigest'];
  requireRule(Object.keys(copy).every(key => fields.includes(key)));
  requireRule(copy.kind === 'createRun' && validateApi('CreateRunRequest', copy.request).ok);
  requireRule(validateApi('Uuid', copy.id).ok && validateApi('Uuid', copy.attemptId).ok
    && !sameUuid(copy.id, copy.attemptId));
  requireRule(validateApi('RunTimestamp', copy.requestedAt).ok);
  const intentDigest = digestMutationIntent({ kind: copy.kind, request: copy.request }, digest);
  requireRule(copy.intentDigest === undefined || copy.intentDigest === intentDigest);
  const { kind, id, attemptId, requestedAt, request } = copy;
  const command = { kind, id, attemptId, requestedAt, request, intentDigest };
  encodeJson(command, 65536);
  return immutableSnapshot(command);
}
