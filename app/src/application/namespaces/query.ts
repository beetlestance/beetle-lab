import { encodeJson } from '@beetle/contracts';
import { validateApi } from '@beetle/contracts/api';
import type { ApiTypes, Folder, FolderPage, Organization, OrganizationPage, SettingsScope,
  Workspace, WorkspacePage } from '@beetle/contracts/api';
import { immutableSnapshot, requireRule, sameScope, sameUuid } from '../../domain/namespaces/index.js';
import type { EntityKey, EntityKind, ListQuery, NamespaceReader } from '../../ports/namespace-reader.js';

type Entities = { organization: Organization; workspace: Workspace; folder: Folder };
type Pages = { organization: OrganizationPage; workspace: WorkspacePage; folder: FolderPage };
const entitySchema = { organization: 'Organization', workspace: 'Workspace', folder: 'Folder' } as const;
const pageSchema = { organization: 'OrganizationPage', workspace: 'WorkspacePage', folder: 'FolderPage' } as const;
const ownerKind = { organization: 'installation', workspace: 'organization', folder: 'workspace' } as const;

/** A broken effect adapter is an internal failure, not missing user data. */
function checked<N extends keyof ApiTypes>(name: N, input: unknown, scope?: SettingsScope): ApiTypes[N] {
  try {
    let snapshot: unknown = JSON.parse(encodeJson(input, 1_048_576));
    if (scope !== undefined) {
      if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new Error('Invalid page');
      if (Object.hasOwn(snapshot, 'scope')) throw new Error('Invalid page');
      snapshot = { ...snapshot, scope };
    }
    const value = validateApi(name, snapshot);
    if (value.ok) return value.value;
  } catch { /* Convert non-JSON/proxy/oversize adapter results to a fixed error. */ }
  throw new Error('Invalid namespace repository response');
}

export async function getNamespace<K extends EntityKind>(key: EntityKey<K>, reader: NamespaceReader): Promise<Entities[K]> {
  requireRule(key.scope.kind === ownerKind[key.kind], 'not_found');
  const value = checked(entitySchema[key.kind], await reader.get(key));
  requireRule(sameScope(value.scope, key.scope) && sameUuid(value.id, key.id), 'not_found');
  // The constant schema map establishes this conditional result, including exact DTO fields.
  return immutableSnapshot(value) as Entities[K];
}

export async function listNamespaces<K extends EntityKind>(query: ListQuery<K>, reader: NamespaceReader): Promise<Pages[K]> {
  requireRule(query.scope.kind === ownerKind[query.kind], 'not_found');
  const result = await reader.list(query);
  const value = checked(pageSchema[query.kind], result, query.scope);
  if (value.items.length > query.limit) throw new Error('Invalid namespace repository response');
  const ids = new Set<string>();
  for (const item of value.items) {
    requireRule(sameScope(item.scope, query.scope), 'not_found');
    const id = item.id.toLowerCase();
    if (ids.has(id)) throw new Error('Invalid namespace repository response');
    ids.add(id);
  }
  return immutableSnapshot(value) as Pages[K];
}
