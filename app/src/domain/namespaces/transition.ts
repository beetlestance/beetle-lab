import type { Folder, Organization, Workspace } from '@beetle/contracts/api';
import { foldedName, immutableSnapshot, nextVersion, normalizedName, requireRule, sameScope, sameUuid,
  validatedSlug } from './primitives.js';
import { validateFolderPlacement } from './folders.js';
import type { NamespaceChange, NamespaceCommand, NamespaceEntity, NamespaceEvidence } from './types.js';

function existing(command: NamespaceCommand, evidence: NamespaceEvidence): NamespaceEntity {
  const current = evidence.current;
  requireRule(current !== undefined && sameUuid(current.id, command.id), 'not_found');
  requireRule(sameScope(current.scope, command.request.scope), 'not_found');
  requireRule('expectedVersion' in command.request &&
    current.version === command.request.expectedVersion, 'conflict');
  return current;
}

function organizationChange(command: Extract<NamespaceCommand,
  { kind: 'createOrganization' | 'patchOrganization' }>, evidence: NamespaceEvidence): NamespaceChange {
  const current = command.kind === 'patchOrganization' ? existing(command, evidence) : undefined;
  requireRule(current === undefined || 'slug' in current, 'not_found');
  const name = normalizedName(command.request.name ?? (current as Organization).name);
  const slug = validatedSlug(command.request.slug ?? (current as Organization).slug);
  return { entity: { id: command.id, scope: command.request.scope, name, slug,
    version: current ? nextVersion(current.version) : 1 }, foldedName: foldedName(name) };
}

function workspaceChange(command: Extract<NamespaceCommand,
  { kind: 'createWorkspace' | 'patchWorkspace' }>, evidence: NamespaceEvidence): NamespaceChange {
  requireRule(evidence.organization !== undefined &&
    sameUuid(evidence.organization.id, command.request.scope.organizationId), 'not_found');
  if (command.kind === 'patchWorkspace') {
    const current = existing(command, evidence);
    requireRule('rootFolderId' in current, 'not_found');
    const name = normalizedName(command.request.name);
    return { entity: { ...current, name, version: nextVersion(current.version) }, foldedName: foldedName(name) };
  }
  requireRule(!sameUuid(command.id, command.rootFolderId));
  const name = normalizedName(command.request.name);
  const entity: Workspace = { id: command.id, scope: command.request.scope, name,
    rootFolderId: command.rootFolderId, version: 1 };
  const rootFolder: Folder = { id: command.rootFolderId, version: 1, name,
    scope: { kind: 'workspace', organizationId: command.request.scope.organizationId, workspaceId: command.id },
    parentFolderId: null, displayPath: [name] };
  return { entity, rootFolder, foldedName: foldedName(name) };
}

type FolderCommand = Extract<NamespaceCommand, { kind: 'createFolder' | 'patchFolder' }>;

function folderValues(command: FolderCommand, moving: Folder | undefined): {
  name: string; parentFolderId: string | null | undefined;
} {
  return { name: normalizedName(command.request.name ?? moving?.name ?? ''),
    parentFolderId: command.request.parentFolderId ?? moving?.parentFolderId };
}

function folderChange(command: Extract<NamespaceCommand,
  { kind: 'createFolder' | 'patchFolder' }>, evidence: NamespaceEvidence): NamespaceChange {
  const current = command.kind === 'patchFolder' ? existing(command, evidence) : undefined;
  requireRule(current === undefined || 'parentFolderId' in current, 'not_found');
  const moving = current as Folder | undefined;
  const { name, parentFolderId } = folderValues(command, moving);
  requireRule(evidence.folder !== undefined, 'not_found');
  // Root rename is allowed; any explicit reparent attempt is rejected.
  if (moving && sameUuid(moving.id, evidence.folder.workspace.rootFolderId)) {
    requireRule(command.request.parentFolderId === undefined && moving.parentFolderId === null);
    requireRule(sameUuid(evidence.folder.workspace.id, command.request.scope.workspaceId) &&
      sameUuid(evidence.folder.workspace.scope.organizationId, command.request.scope.organizationId), 'not_found');
    return { entity: { ...moving, name, displayPath: [name], version: nextVersion(moving.version) },
      foldedName: foldedName(name) };
  }
  requireRule(typeof parentFolderId === 'string', 'not_found');
  const displayPath = validateFolderPlacement({ scope: command.request.scope, parentFolderId,
    ...(moving ? { moving } : {}), evidence: evidence.folder });
  const entity: Folder = { id: command.id, version: current ? nextVersion(current.version) : 1,
    scope: command.request.scope, name, parentFolderId, displayPath: [...displayPath, name] };
  return { entity, foldedName: foldedName(name) };
}

export function decideNamespaceChange(command: NamespaceCommand, evidence: NamespaceEvidence): NamespaceChange {
  switch (command.kind) {
    case 'createOrganization': case 'patchOrganization': return immutableSnapshot(organizationChange(command, evidence));
    case 'createWorkspace': case 'patchWorkspace': return immutableSnapshot(workspaceChange(command, evidence));
    case 'createFolder': case 'patchFolder': return immutableSnapshot(folderChange(command, evidence));
  }
}
