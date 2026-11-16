import type { SettingsScope } from '@beetle/contracts/api';
import type { NamespaceEntity } from '../domain/namespaces/index.js';

export type EntityKind = 'organization' | 'workspace' | 'folder';
export interface EntityKey<K extends EntityKind = EntityKind> { kind: K; scope: SettingsScope; id: string }
export interface ListQuery<K extends EntityKind = EntityKind> {
  kind: K; scope: SettingsScope; parentFolderId?: string; limit: number; cursor?: string;
}
export interface EntityPage { items: NamespaceEntity[]; nextCursor: string | null }
/** Scope is explicit on every lookup; wrong owner is not_found. Pages are <=100
 * stable identities and opaque cursors bind kind, scope, limit and optional parent.
 * Paths are derived with bounded ancestor reads, never a full tree load.
 */
export interface NamespaceReader {
  get(key: EntityKey): Promise<NamespaceEntity>;
  list(query: ListQuery): Promise<EntityPage>;
}
