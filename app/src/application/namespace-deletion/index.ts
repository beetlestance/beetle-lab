import { encodeCanonicalJson, validatePrimitive } from '@beetle/contracts';
import { validateApi } from '@beetle/contracts/api';
import { immutableSnapshot, requireRule, sameScope, sameUuid } from '../../domain/namespaces/index.js';
import { digestMutationIntent } from '../namespaces/index.js';
import type { IntentDigest } from '../namespaces/index.js';
import type { NamespaceDeletionIntent, NamespaceDeletionCommand, NamespaceDeletionStore } from '../../ports/namespace-deletion.js';
export function prepareNamespaceDeletion(input: NamespaceDeletionIntent, digest: IntentDigest): NamespaceDeletionCommand {
  const value = immutableSnapshot({kind: input.kind, id: input.id, request: input.request}) as NamespaceDeletionIntent;
  requireRule(['organization', 'workspace', 'folder'].includes(value.kind));
  const names = {organization: 'DeleteOrganizationRequest', workspace: 'DeleteWorkspaceRequest', folder: 'DeleteFolderRequest'} as const;
  requireRule(validateApi(names[value.kind], value.request).ok && validatePrimitive('uuid', value.id).ok);
  return immutableSnapshot({...value, intentDigest: digestMutationIntent({operation: 'deleteNamespace', ...value}, digest)});
}
export function captureNamespaceDeletionReply(command: NamespaceDeletionCommand, input: unknown) {
  const checked = validateApi('DeletionReceipt', JSON.parse(encodeCanonicalJson(input, 2048)) as unknown);
  if (!checked.ok) throw new Error('Invalid namespace deletion receipt'); const value = checked.value;
  requireRule(sameUuid(value.id, command.id) && sameScope(value.scope, command.request.scope)
    && sameUuid(value.requestId, command.request.requestId) && value.version === command.request.expectedVersion + 1
    && value.state === 'tombstoned' && value.cleanup === 'complete');
  return immutableSnapshot(value);
}
export async function deleteNamespace(intent: NamespaceDeletionIntent, store: NamespaceDeletionStore, digest: IntentDigest) {
  const command = prepareNamespaceDeletion(intent, digest);
  return captureNamespaceDeletionReply(command, await store.delete(command));
}
