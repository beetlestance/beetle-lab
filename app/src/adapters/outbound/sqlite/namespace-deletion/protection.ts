import type { DatabaseSync } from 'node:sqlite';
import { requireRule } from '../../../../domain/namespaces/index.js';
type Kind = 'organization' | 'workspace' | 'folder';
export const namespaceTables = {organization: 'organizations', workspace: 'workspaces', folder: 'folders'} as const;
/** Fixed SQL only. EXISTS stops at one indexed child; FKs remain the final guard. */
export function namespaceProtectionSql(kind: Kind): string {
  if (kind === 'organization') return 'EXISTS(SELECT 1 FROM workspaces WHERE organization_id=target.id LIMIT 1)';
  const owner = 'organization_id=target.organization_id AND workspace_id=' + (kind === 'workspace' ? 'target.id' : 'target.workspace_id');
  if (kind === 'folder') return [
    `EXISTS(SELECT 1 FROM folders WHERE ${owner} AND parent_id=target.id LIMIT 1)`,
    ...['suites','input_blobs'].map(table => `EXISTS(SELECT 1 FROM ${table} WHERE ${owner} AND folder_id=target.id LIMIT 1)`),
  ].join(' OR ');
  return [
    `EXISTS(SELECT 1 FROM folders WHERE ${owner} AND id!=target.root_folder_id LIMIT 1)`,
    ...['suites','input_blobs','runs','backend_retired_runs','retention_workspace_epochs','retention_snapshots']
      .map(table => `EXISTS(SELECT 1 FROM ${table} WHERE ${owner} LIMIT 1)`),
  ].join(' OR ');
}
export function requireEmptyNamespace(db: DatabaseSync, kind: Kind, id: string): void {
  const row = db.prepare(`SELECT (${namespaceProtectionSql(kind)}) protected FROM ${namespaceTables[kind]} target WHERE target.id=?`).get(id);
  requireRule(row?.protected === 0, 'conflict');
}
