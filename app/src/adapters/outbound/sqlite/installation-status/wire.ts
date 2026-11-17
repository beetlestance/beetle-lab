import { validateApi } from '@beetle/contracts/api';
import type { RunKey } from '../../../../ports/runs.js';
import { requireRule } from '../../../../domain/namespaces/index.js';

export type StatusOperation = { kind: 'getPoolUsage' } | { kind: 'getRunQueue'; key: RunKey };
const kinds = ['getPoolUsage', 'getRunQueue'];

/** Inspects the data descriptor only; accessors are rejected by the bounded copy owner. */
export function statusOperation(operation: unknown): operation is StatusOperation {
  if (typeof operation !== 'object' || operation === null) return false;
  const descriptor = Object.getOwnPropertyDescriptor(operation, 'kind');
  return descriptor !== undefined && 'value' in descriptor && kinds.includes(descriptor.value as string);
}
/** Closed envelope: the worker transport may add only a positive safe-integer messageId. */
export function checkStatusOperation(operation: StatusOperation): void {
  const envelope = operation as StatusOperation & { messageId?: unknown };
  const hasMessageId = Object.hasOwn(envelope, 'messageId');
  if (hasMessageId) {
    const id = envelope.messageId;
    requireRule(typeof id === 'number' && Number.isSafeInteger(id) && id > 0);
  }
  const fields = operation.kind === 'getPoolUsage' ? 1 : 2;
  requireRule(Object.keys(operation).length === fields + (hasMessageId ? 1 : 0));
  if (operation.kind === 'getPoolUsage') return;
  requireRule(Object.hasOwn(operation, 'key') && Object.keys(operation.key).length === 2);
  requireRule(validateApi('WorkspaceScope', operation.key.scope).ok && validateApi('Uuid', operation.key.id).ok);
}
