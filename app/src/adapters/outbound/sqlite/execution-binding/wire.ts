import { validateApi } from '@beetle/contracts/api';
import type { Run } from '@beetle/contracts/api';
import { captureEventBinding } from '../../../../domain/events/index.js';
import { requireRule } from '../../../../domain/namespaces/index.js';
import type { RunExecutionSnapshot } from '../../../../ports/run-live-metrics.js';
import type { RunKey } from '../../../../ports/runs.js';
import { boundedCopy, lower } from '../input-values.js';
import type { Operation } from '../protocol.js';
type ExecutionOperation = Extract<Operation, {kind: 'getRunExecution'}>;
export function executionOperation(input: unknown): input is ExecutionOperation {
  if (!input || typeof input !== 'object') return false;
  const kind = Object.getOwnPropertyDescriptor(input, 'kind');
  return !!kind && 'value' in kind && kind.value === 'getRunExecution';
}
export function captureExecutionOperation(input: unknown): ExecutionOperation {
  const copy = boundedCopy(input, 4096) as ExecutionOperation & {messageId?: number};
  requireRule(executionOperation(copy));
  requireRule(Object.keys(copy).every(key => ['kind', 'key', 'messageId'].includes(key)));
  if (Object.hasOwn(copy, 'messageId')) requireRule(Number.isSafeInteger(copy.messageId) && copy.messageId! > 0);
  requireRule(copy.key !== null && typeof copy.key === 'object' && Object.keys(copy.key).sort().join(',') === 'id,scope');
  requireRule(validateApi('WorkspaceScope', copy.key.scope).ok && validateApi('Uuid', copy.key.id).ok);
  return {kind: 'getRunExecution', key: {id: lower(copy.key.id), scope: {kind: 'workspace',
    organizationId: lower(copy.key.scope.organizationId), workspaceId: lower(copy.key.scope.workspaceId)}}};
}
export function captureExecutionReply(key: RunKey, input: unknown): RunExecutionSnapshot {
  const copy = boundedCopy(input, 16384) as {run: unknown; binding: unknown};
  requireRule(copy !== null && typeof copy === 'object' && Object.keys(copy).sort().join(',') === 'binding,run');
  const checked = validateApi('Run', copy.run); requireRule(checked.ok);
  const run: Run = checked.value;
  requireRule(run.id === lower(key.id) && run.scope.organizationId === lower(key.scope.organizationId)
    && run.scope.workspaceId === lower(key.scope.workspaceId));
  const binding = copy.binding === null ? null : captureEventBinding(copy.binding);
  if (binding) {
    const attempt = binding.key.attempt;
    requireRule(binding.key.runId === run.id && attempt.attemptId === run.activeAttemptId
      && attempt.organizationId === run.scope.organizationId && attempt.workspaceId === run.scope.workspaceId);
  }
  return {run, binding};
}
