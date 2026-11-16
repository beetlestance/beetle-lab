import type { DatabaseSync } from 'node:sqlite';
import type { NamespaceEntity } from '../../../../ports/namespaces.js';
import type { NamespaceDeletionCommand } from '../../../../ports/namespace-deletion.js';
import { requireRule } from '../../../../domain/namespaces/index.js';
import { storageFits } from '../../../../domain/settings/index.js';
import { lower, scopeKey } from '../input-values.js';
export function reserveNamespaceMarker(db: DatabaseSync, command: NamespaceDeletionCommand, entity: NamespaceEntity): void {
  const usage = db.prepare('SELECT charged_bytes FROM installation_storage_usage WHERE id=1').get()?.charged_bytes;
  const limits = db.prepare(`SELECT json_extract(value_json,'$.pool.storageBytes') allocation,
    json_extract(value_json,'$.pool.freeSpaceReserveBytes') reserve FROM settings WHERE scope_key='installation'`).get();
  requireRule(typeof usage === 'number' && typeof limits?.allocation === 'number' && typeof limits.reserve === 'number');
  requireRule(storageFits({chargedBytes: usage, requestedBytes: 2048, allocationBytes: limits.allocation, reserveBytes: limits.reserve}), 'capacity_unavailable');
  const settingsId = originalSettingsId(db, command, entity);
  db.prepare('INSERT INTO namespace_deletions(id,kind,scope_key,version,root_id,settings_id,charged_bytes) VALUES(?,?,?,?,?,?,2048)')
    .run(lower(entity.id), command.kind, scopeKey(command.request.scope), entity.version + 1,
      'rootFolderId' in entity ? entity.rootFolderId : null, settingsId as string | null);
}

function originalSettingsId(db: DatabaseSync, command: NamespaceDeletionCommand, entity: NamespaceEntity) {
  const owner = command.kind === 'folder' ? null : command.kind === 'organization' ? `organization:${lower(entity.id)}`
    : `workspace:${lower(command.request.scope.kind === 'organization' ? command.request.scope.organizationId : '')}:${lower(entity.id)}`;
  const settingsId = owner === null ? null : db.prepare('SELECT id FROM settings WHERE scope_key=?').get(owner)?.id;
  requireRule(owner === null || typeof settingsId === 'string');
  return settingsId;
}
