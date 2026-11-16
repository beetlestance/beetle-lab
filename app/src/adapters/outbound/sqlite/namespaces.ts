import type { DatabaseSync } from 'node:sqlite';
import type { Folder } from '@beetle/contracts/api';
import { decideNamespaceChange, requireRule } from '../../../domain/namespaces/index.js';
import type { NamespaceCommand, NamespaceEntity, NamespaceEvidence } from '../../../ports/namespaces.js';
import type { Entities } from './entities.js';
import { lower } from './input.js';
import type { Settings } from './settings.js';

export class Namespaces {
  constructor(private readonly db: DatabaseSync, private readonly entities: Entities, private readonly settings: Settings) {}
  private evidence(command: NamespaceCommand): NamespaceEvidence {
    switch (command.kind) {
      case 'createOrganization': return {};
      case 'patchOrganization': return { current: this.entities.organization(command.id) };
      case 'createWorkspace': return { organization: this.entities.organization(command.request.scope.organizationId) };
      case 'patchWorkspace': return { organization: this.entities.organization(command.request.scope.organizationId),
        current: this.entities.workspace(command.request.scope, command.id) };
      case 'createFolder': case 'patchFolder': return this.folderEvidence(command);
    }
  }
  private folderEvidence(command: Extract<NamespaceCommand, { kind: 'createFolder' | 'patchFolder' }>): NamespaceEvidence {
    const scope = command.request.scope;
    const workspace = this.entities.workspace({ kind: 'organization', organizationId: scope.organizationId }, scope.workspaceId);
    const current = command.kind === 'patchFolder' ? this.entities.folder(scope, command.id) : undefined;
    const parent = command.request.parentFolderId ?? current?.parentFolderId ?? workspace.rootFolderId;
    return { ...(current ? { current } : {}), folder: { workspace,
      parentChain: this.entities.parentChain(scope, parent),
      subtreeHeight: current ? this.entities.subtreeHeight(scope, current.id) : 0 } };
  }
  private insertFolder(folder: Folder, folded: string): void {
    this.db.prepare(`INSERT INTO folders(id,organization_id,workspace_id,parent_id,version,name,folded_name)
      VALUES (?,?,?,?,?,?,?)`).run(lower(folder.id), lower(folder.scope.organizationId), lower(folder.scope.workspaceId),
      folder.parentFolderId === null ? null : lower(folder.parentFolderId), folder.version, folder.name, folded);
  }
  private organization(command: NamespaceCommand, entity: NamespaceEntity): void {
    requireRule('slug' in entity);
    if (command.kind === 'createOrganization') {
      this.db.prepare('INSERT INTO organizations(id,version,name,slug) VALUES (?,?,?,?)')
        .run(lower(entity.id), entity.version, entity.name, entity.slug);
      this.settings.createOverrides({ kind: 'organization', organizationId: lower(entity.id) });
    } else this.db.prepare('UPDATE organizations SET version=?,name=?,slug=? WHERE id=?')
      .run(entity.version, entity.name, entity.slug, lower(entity.id));
  }
  private workspace(command: NamespaceCommand, entity: NamespaceEntity, folded: string, root?: Folder): void {
    requireRule('rootFolderId' in entity);
    if (command.kind === 'createWorkspace') {
      this.db.prepare(`INSERT INTO workspaces(id,organization_id,version,name,folded_name,root_folder_id)
        VALUES (?,?,?,?,?,?)`).run(lower(entity.id), lower(entity.scope.organizationId), entity.version,
        entity.name, folded, lower(entity.rootFolderId));
      requireRule(root !== undefined); this.insertFolder(root, folded);
      this.settings.createOverrides({ kind: 'workspace', organizationId: lower(entity.scope.organizationId), workspaceId: lower(entity.id) });
    } else this.db.prepare('UPDATE workspaces SET version=?,name=?,folded_name=? WHERE id=? AND organization_id=?')
      .run(entity.version, entity.name, folded, lower(entity.id), lower(entity.scope.organizationId));
  }
  private folder(command: NamespaceCommand, entity: NamespaceEntity, folded: string): void {
    requireRule('parentFolderId' in entity);
    if (command.kind === 'createFolder') this.insertFolder(entity, folded);
    else this.db.prepare(`UPDATE folders SET version=?,name=?,folded_name=?,parent_id=?
      WHERE id=? AND organization_id=? AND workspace_id=?`).run(entity.version, entity.name, folded,
      entity.parentFolderId === null ? null : lower(entity.parentFolderId), lower(entity.id),
      lower(entity.scope.organizationId), lower(entity.scope.workspaceId));
  }
  change(command: NamespaceCommand): NamespaceEntity {
    const change = decideNamespaceChange(command, this.evidence(command));
    const entity = change.entity;
    if ('slug' in entity) this.organization(command, entity);
    else if ('rootFolderId' in entity) this.workspace(command, entity, change.foldedName, change.rootFolder);
    else this.folder(command, entity, change.foldedName);
    const kind = 'slug' in entity ? 'organization' : 'rootFolderId' in entity ? 'workspace' : 'folder';
    return this.entities.get({ kind, id: entity.id, scope: entity.scope });
  }
}
