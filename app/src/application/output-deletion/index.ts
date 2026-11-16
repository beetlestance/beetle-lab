import { encodeJson } from '@beetle/contracts';
import { validateApi } from '@beetle/contracts/api';
import { requireRule, immutableSnapshot } from '../../domain/namespaces/index.js';
import { digestMutationIntent } from '../namespaces/index.js';
import type { IntentDigest } from '../namespaces/index.js';
import type { OutputDeletionCommand } from '../../ports/output-deletion-metadata.js';
/** One logical request; allocation identity and wall time do not alter replay. */
export function prepareOutputDeletion(input: Omit<OutputDeletionCommand, 'intentDigest'> & {readonly intentDigest?: string}, digest: IntentDigest): OutputDeletionCommand {
  const copy = JSON.parse(encodeJson(input, 4096)) as typeof input;
  requireRule(Object.keys(copy).every(key => ['kind', 'id', 'requestedAt', 'request', 'intentDigest'].includes(key)));
  requireRule(copy.kind === 'beginOutputDeletion' && validateApi('Uuid', copy.id).ok && validateApi('RunTimestamp', copy.requestedAt).ok);
  const request = copy.request;
  requireRule(request !== null && typeof request === 'object' && Object.keys(request).length === 4);
  requireRule(validateApi('WorkspaceScope', request.scope).ok && validateApi('Uuid', request.requestId).ok && validateApi('Uuid', request.runId).ok);
  requireRule(Number.isSafeInteger(request.expectedRunVersion) && request.expectedRunVersion > 0);
  const intentDigest = digestMutationIntent({kind: copy.kind, request}, digest);
  requireRule(copy.intentDigest === undefined || copy.intentDigest === intentDigest);
  return immutableSnapshot({kind: copy.kind, id: copy.id.toLowerCase(), requestedAt: copy.requestedAt, request, intentDigest});
}
