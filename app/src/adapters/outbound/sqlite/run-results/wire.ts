import { verifyEngineResultSeal } from '@beetle/contracts';
import { validateApi } from '@beetle/contracts/api';
import type { RunResultSnapshot } from '@beetle/contracts/api';
import type { RunKey } from '../../../../ports/runs.js';
import { requireRule } from '../../../../domain/namespaces/index.js';
import { boundedCopy, lower, sha256 } from '../input-values.js';
import type { Operation } from '../protocol.js';

export type ResultOperation = Extract<Operation, { kind: 'getRunResult' }>;
export function resultOperation(input: unknown): input is ResultOperation {
  if (!input || typeof input !== 'object') return false;
  const kind = Object.getOwnPropertyDescriptor(input, 'kind');
  return !!kind && 'value' in kind && kind.value === 'getRunResult';
}
export function captureResultOperation(input: unknown): ResultOperation {
  const copy = boundedCopy(input, 4096) as ResultOperation & { messageId?: number };
  requireRule(resultOperation(copy));
  requireRule(Object.keys(copy).every(key => ['kind', 'key', 'messageId'].includes(key)));
  if (Object.hasOwn(copy, 'messageId')) requireRule(Number.isSafeInteger(copy.messageId) && copy.messageId! > 0);
  requireRule(copy.key !== null && typeof copy.key === 'object'
    && Object.keys(copy.key).every(key => ['scope', 'id'].includes(key)));
  requireRule(validateApi('WorkspaceScope', copy.key.scope).ok && validateApi('Uuid', copy.key.id).ok);
  return { kind: 'getRunResult', key: { id: lower(copy.key.id), scope: { kind: 'workspace',
    organizationId: lower(copy.key.scope.organizationId), workspaceId: lower(copy.key.scope.workspaceId) } } };
}
/** The original reply remains owned until bounded schema, identity and seal capture completes. */
export function captureResultReply(key: RunKey, input: unknown): RunResultSnapshot {
  const copy: unknown = boundedCopy(input, 73728);
  const checked = validateApi('RunResultSnapshot', copy); requireRule(checked.ok);
  const value = checked.value;
  requireRule(value.id === lower(key.id) && value.scope.organizationId === lower(key.scope.organizationId)
    && value.scope.workspaceId === lower(key.scope.workspaceId));
  if (value.result !== null) {
    const result = value.result;
    requireRule(result.attemptId === value.activeAttemptId && result.organizationId === value.scope.organizationId
      && result.workspaceId === value.scope.workspaceId && result.generation === 1);
    requireRule(verifyEngineResultSeal(result, sha256).ok);
  }
  return value;
}
