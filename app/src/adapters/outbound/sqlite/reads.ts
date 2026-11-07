import type { DatabaseSync } from 'node:sqlite';
import { requireRule } from '../../../domain/namespaces/index.js';
import { folderEntity } from './entities.js';
import type { Entities, FolderRow } from './entities.js';
import { boundedCopy, lower, scopeKey, sha256, uuid } from './input.js';
import type { EntityPage, ListQuery } from './protocol.js';
import { StorageError } from './protocol.js';

function queryIdentity(query: ListQuery): string {
  return sha256(JSON.stringify([query.kind, scopeKey(query.scope), query.limit,
    query.parentFolderId === undefined ? null : lower(query.parentFolderId)]));
}
function continuation(query: ListQuery): string {
  if (query.cursor === undefined) return '';
  try {
    const text = Buffer.from(query.cursor, 'base64url').toString('utf8');
    const value = boundedCopy(JSON.parse(text) as { identity: string; after: string }, 1024);
    requireRule(value.identity === queryIdentity(query)); uuid(value.after);
    requireRule(value.after === lower(value.after));
    return value.after;
  } catch { throw new StorageError('invalid_input'); }
}
export class Reads {
  constructor(private readonly db: DatabaseSync, private readonly entities: Entities) {}
  list(query: ListQuery): EntityPage {
    const after = continuation(query);
    const rows = this.rows(query, after);
    const selected = rows.slice(0, query.limit);
    const items = this.items(query, selected);
    const last = selected.at(-1);
    const nextCursor = rows.length > query.limit && last ? Buffer.from(JSON.stringify({
      identity: queryIdentity(query), after: last.id })).toString('base64url') : null;
    return { items, nextCursor };
  }
  private rows(query: ListQuery, after: string): { id: string }[] {
    const scope = query.scope;
    if (query.kind === 'organization') return this.db.prepare('SELECT id FROM organizations WHERE id>? ORDER BY id LIMIT ?')
      .all(after, query.limit + 1) as unknown as { id: string }[];
    requireRule(scope.kind !== 'installation', 'not_found');
    this.entities.organization(scope.organizationId);
    if (query.kind === 'workspace') return this.db.prepare('SELECT id FROM workspaces WHERE organization_id=? AND id>? ORDER BY id LIMIT ?')
      .all(lower(scope.organizationId), after, query.limit + 1) as unknown as { id: string }[];
    requireRule(scope.kind === 'workspace', 'not_found');
    this.entities.workspace({ kind: 'organization', organizationId: scope.organizationId }, scope.workspaceId);
    if (query.parentFolderId === undefined) return this.db.prepare(`SELECT id,organization_id,workspace_id,parent_id,name,version
      FROM folders WHERE organization_id=? AND workspace_id=? AND id>? ORDER BY id LIMIT ?`)
      .all(lower(scope.organizationId), lower(scope.workspaceId), after, query.limit + 1) as unknown as FolderRow[];
    this.entities.folderRow(scope, query.parentFolderId);
    return this.db.prepare(`SELECT id,organization_id,workspace_id,parent_id,name,version FROM folders
      WHERE organization_id=? AND workspace_id=? AND parent_id=? AND id>? ORDER BY id LIMIT ?`)
      .all(lower(scope.organizationId), lower(scope.workspaceId), lower(query.parentFolderId), after,
        query.limit + 1) as unknown as FolderRow[];
  }
  private items(query: ListQuery, rows: { id: string }[]) {
    if (query.kind !== 'folder') return rows.map(row => this.entities.get({ ...query, id: row.id }));
    const scope = query.scope;
    requireRule(scope.kind === 'workspace', 'not_found');
    if (query.parentFolderId === undefined) return rows.map(row => this.entities.folder(scope, row.id));
    const path = this.entities.parentChain(scope, query.parentFolderId).map(parent => parent.name);
    return (rows as FolderRow[]).map(row => folderEntity(row, [...path, row.name]));
  }
}
