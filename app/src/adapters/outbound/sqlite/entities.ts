import type { DatabaseSync } from 'node:sqlite';
import type { Folder, Organization, Workspace, SettingsScope, WorkspaceScope } from '@beetle/contracts/api';
import { requireRule } from '../../../domain/namespaces/index.js';
import type { NamespaceEntity } from '../../../ports/namespaces.js';
import { lower } from './input.js';
import type { EntityKey } from './protocol.js';

interface OrganizationRow { id: string; name: string; slug: string; version: number }
interface WorkspaceRow { id: string; organization_id: string; name: string; root_folder_id: string; version: number }
export interface FolderRow { id: string; organization_id: string; workspace_id: string; parent_id: string | null;
  name: string; version: number }
export function folderEntity(row: FolderRow, displayPath: string[]): Folder {
  return { id: row.id, version: row.version, name: row.name, parentFolderId: row.parent_id,
    scope: { kind: 'workspace', organizationId: row.organization_id, workspaceId: row.workspace_id }, displayPath };
}

export class Entities {
  constructor(private readonly db: DatabaseSync) {}
  organization(id: string): Organization {
    const row = this.db.prepare('SELECT id,name,slug,version FROM organizations WHERE id=?').get(lower(id)) as
      unknown as OrganizationRow | undefined;
    requireRule(row !== undefined, 'not_found');
    return { ...row, scope: { kind: 'installation' } };
  }
  workspace(scope: SettingsScope, id: string): Workspace {
    requireRule(scope.kind === 'organization', 'not_found');
    const row = this.db.prepare('SELECT id,organization_id,name,root_folder_id,version FROM workspaces WHERE organization_id=? AND id=?')
      .get(lower(scope.organizationId), lower(id)) as unknown as WorkspaceRow | undefined;
    requireRule(row !== undefined, 'not_found');
    return { id: row.id, name: row.name, rootFolderId: row.root_folder_id, version: row.version,
      scope: { kind: 'organization', organizationId: row.organization_id } };
  }
  folderRow(scope: WorkspaceScope, id: string): FolderRow {
    const row = this.db.prepare('SELECT id,organization_id,workspace_id,parent_id,name,version FROM folders WHERE organization_id=? AND workspace_id=? AND id=?')
      .get(lower(scope.organizationId), lower(scope.workspaceId), lower(id)) as unknown as FolderRow | undefined;
    requireRule(row !== undefined, 'not_found'); return row;
  }
  parentChain(scope: WorkspaceScope, id: string): Folder[] {
    const rows = this.db.prepare(`WITH RECURSIVE ancestors(id,organization_id,workspace_id,parent_id,name,version,depth) AS (
      SELECT id,organization_id,workspace_id,parent_id,name,version,1 FROM folders
      WHERE organization_id=? AND workspace_id=? AND id=?
      UNION ALL SELECT f.id,f.organization_id,f.workspace_id,f.parent_id,f.name,f.version,a.depth+1
      FROM ancestors a JOIN folders f ON f.id=a.parent_id AND f.organization_id=a.organization_id
      AND f.workspace_id=a.workspace_id WHERE a.depth<9)
      SELECT * FROM ancestors ORDER BY depth DESC LIMIT 9`)
      .all(lower(scope.organizationId), lower(scope.workspaceId), lower(id)) as unknown as FolderRow[];
    requireRule(rows.length > 0, 'not_found');
    requireRule(rows.length <= 8 && rows[0]!.parent_id === null);
    return rows.map((row, index) => folderEntity(row, rows.slice(0, index + 1).map(parent => parent.name)));
  }
  folder(scope: WorkspaceScope, id: string): Folder { return this.parentChain(scope, id).at(-1)!; }
  get(key: EntityKey): NamespaceEntity {
    switch (key.kind) {
      case 'organization': return this.organization(key.id);
      case 'workspace': return this.workspace(key.scope, key.id);
      case 'folder': requireRule(key.scope.kind === 'workspace', 'not_found'); return this.folder(key.scope, key.id);
    }
  }
  subtreeHeight(scope: WorkspaceScope, id: string): number {
    const root = this.folderRow(scope, id);
    const queue = [{ id: root.id, depth: 0 }];
    const seen = new Set([root.id]);
    const children = this.db.prepare(`SELECT id FROM folders INDEXED BY folders_children
      WHERE organization_id=? AND workspace_id=? AND parent_id=? ORDER BY id LIMIT ?`);
    let height = 0;
    for (let head = 0; head < queue.length; head++) {
      const node = queue[head]!;
      const remaining = 10000 - seen.size;
      // Indexed enumeration stops before an oversized child batch can enter the frontier.
      // Previous children + remaining + one overflow sentinel total at most 10,000.
      const rows = children.all(lower(scope.organizationId), lower(scope.workspaceId), node.id,
        remaining + 1) as unknown as { id: string }[];
      requireRule(rows.length <= remaining);
      for (const child of rows) {
        const depth = node.depth + 1;
        requireRule(depth < 8 && !seen.has(child.id));
        seen.add(child.id); queue.push({ id: child.id, depth }); height = Math.max(height, depth);
      }
    }
    return height;
  }
}
