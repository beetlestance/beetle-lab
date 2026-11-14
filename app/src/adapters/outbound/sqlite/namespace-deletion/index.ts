import { requireEmptyNamespace } from './protection.js';
import type { DatabaseSync } from 'node:sqlite';
import type { DeletionReceipt, SettingsScope } from '@beetle/contracts/api';
import { requireRule } from '../../../../domain/namespaces/index.js';
import type { NamespaceDeletionCommand } from '../../../../ports/namespace-deletion.js';
import type { NamespaceEntity } from '../../../../ports/namespaces.js';
interface EntityLookup { get(key: {kind: 'organization' | 'workspace' | 'folder'; id: string; scope: SettingsScope}): NamespaceEntity }
import { lower } from '../input-values.js';
import { readMutationReceipt, writeMutationReceipt } from '../mutation-receipts.js';
import { transaction } from '../transaction.js';
import { captureNamespaceDeletionReply } from './wire.js';
import { reserveNamespaceMarker } from './marker.js';
function remove(db: DatabaseSync, command: NamespaceDeletionCommand, entities: EntityLookup): DeletionReceipt {
  const {id,kind,request} = command;
  const entity = entities.get({kind, id, scope: request.scope});
  requireRule(entity.version === request.expectedVersion, 'conflict');
  requireRule(entity.version < Number.MAX_SAFE_INTEGER, 'conflict');
  if ('parentFolderId' in entity) requireRule(entity.parentFolderId !== null, 'conflict');
  requireEmptyNamespace(db, kind, lower(id));
  reserveNamespaceMarker(db, command, entity);
  return {id: lower(id), version: entity.version + 1, scope: request.scope, requestId: request.requestId,
    state: 'tombstoned', cleanup: 'complete'};
}
/** Any FK/receipt/funding failure rolls back namespace, settings, index and charge together. */
export function deleteNamespaceRows(db: DatabaseSync, command: NamespaceDeletionCommand, entities: EntityLookup): DeletionReceipt {
  return transaction(db, () => {
    const receipt = readMutationReceipt(db, command, 2048);
    if (receipt.kind === 'stored') return captureNamespaceDeletionReply(command, receipt.value);
    const value = remove(db, command, entities);
    return captureNamespaceDeletionReply(command, writeMutationReceipt(db, command, value, 2048));
  });
}
export { captureNamespaceDeletionOperation, captureNamespaceDeletionReply } from './wire.js';
export type { NamespaceDeletionOperation } from './wire.js';
