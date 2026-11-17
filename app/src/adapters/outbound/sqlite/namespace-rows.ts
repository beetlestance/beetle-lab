import { validateApi } from '@beetle/contracts/api';
import type { Organization, Workspace, WorkspaceScope } from '@beetle/contracts/api';
import { sameScope } from '../../../domain/namespaces/index.js';
import { StorageError } from './protocol.js';

export interface FolderRow {
  id: string;
  organization_id: string;
  workspace_id: string;
  parent_id: string | null;
  name: string;
  version: number;
}
function unavailable(): never {
  throw new StorageError('unavailable');
}
function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return unavailable();
  return input as Record<string, unknown>;
}
/** All identifiers are fixed by this owner, never supplied by a request. */
export function namespaceColumns(kind: 'organization' | 'workspace' | 'folder', alias: '' | 'f.' = ''): string {
  const fields = {
    organization: ['id', 'name', 'slug'],
    workspace: ['id', 'organization_id', 'name', 'root_folder_id'],
    folder: ['id', 'organization_id', 'workspace_id', 'parent_id', 'name'],
  }[kind];
  return [
    ...fields.map((name) => {
      const column = alias + name;
      const maximum = name === 'name' ? 512 : name === 'slug' ? 128 : 45;
      const nullable = name === 'parent_id';
      return `CASE ${nullable ? `WHEN ${column} IS NULL THEN NULL` : ''}
      WHEN typeof(${column})='text' AND length(CAST(${column} AS BLOB))<=${maximum}
      THEN ${column} ELSE ${nullable ? "''" : 'NULL'} END AS ${name}`;
    }),
    alias + 'version',
  ].join(',');
}
export const namespaceIdColumn =
  "CASE WHEN typeof(id)='text' AND length(CAST(id AS BLOB))<=45 THEN id ELSE NULL END AS id";
export function captureNamespaceId(input: unknown): { id: string } {
  const parsed = validateApi('Uuid', record(input).id);
  if (!parsed.ok || parsed.value !== parsed.value.toLowerCase()) return unavailable();
  return { id: parsed.value };
}
export function captureOrganization(input: unknown, expectedId: string): Organization {
  const row = record(input);
  const parsed = validateApi('Organization', {
    id: row.id,
    name: row.name,
    slug: row.slug,
    version: row.version,
    scope: { kind: 'installation' },
  });
  if (!parsed.ok || parsed.value.id !== expectedId.toLowerCase()) return unavailable();
  return parsed.value;
}
export function captureWorkspace(input: unknown, organizationId: string, expectedId: string): Workspace {
  const row = record(input);
  const parsed = validateApi('Workspace', {
    id: row.id,
    name: row.name,
    rootFolderId: row.root_folder_id,
    version: row.version,
    scope: { kind: 'organization', organizationId: row.organization_id },
  });
  if (
    !parsed.ok ||
    parsed.value.id !== expectedId.toLowerCase() ||
    parsed.value.scope.organizationId !== organizationId.toLowerCase()
  )
    return unavailable();
  return parsed.value;
}
export function captureFolderRow(input: unknown, expected: WorkspaceScope, expectedId?: string): FolderRow {
  const row = record(input);
  const parsed = validateApi('Folder', {
    id: row.id,
    name: row.name,
    version: row.version,
    parentFolderId: row.parent_id,
    scope: { kind: 'workspace', organizationId: row.organization_id, workspaceId: row.workspace_id },
    displayPath: [],
  });
  if (!parsed.ok || !sameScope(parsed.value.scope, expected)) return unavailable();
  const value = parsed.value;
  if (expectedId !== undefined && value.id !== expectedId.toLowerCase()) return unavailable();
  return {
    id: value.id,
    organization_id: value.scope.organizationId,
    workspace_id: value.scope.workspaceId,
    parent_id: value.parentFolderId,
    name: value.name,
    version: value.version,
  };
}
