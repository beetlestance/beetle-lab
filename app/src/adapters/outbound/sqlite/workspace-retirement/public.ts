import type { DatabaseSync } from 'node:sqlite';
import type { Operation } from '../protocol.js';
import type { EntityKey } from '../protocol.js';
import type { Entities } from '../entities.js';
import { requireVisibleWorkspace } from './visibility.js';
type Mutation = Extract<
  Operation,
  { kind: 'namespace' | 'settings' | 'suite' | 'input' | 'run' | 'cancelRun' | 'exportJob' }
>;
/** Fence new public work before an ordinary old mutation receipt can return authority. */
export function requireVisibleMutation(db: DatabaseSync, operation: Mutation): void {
  const scope = operation.command.request.scope;
  if (scope.kind === 'workspace') requireVisibleWorkspace(db, scope);
  if (operation.kind === 'namespace' && operation.command.kind === 'patchWorkspace') {
    const command = operation.command;
    requireVisibleWorkspace(db, {
      kind: 'workspace',
      organizationId: command.request.scope.organizationId,
      workspaceId: command.id,
    });
  }
}
/** Old CREATE acknowledgements remain historical; lookups never revive their retired IDs. */
export function visibleEntity(db: DatabaseSync, entities: Entities, key: EntityKey) {
  if (key.scope.kind === 'workspace') requireVisibleWorkspace(db, key.scope);
  if (key.kind === 'workspace' && key.scope.kind === 'organization')
    requireVisibleWorkspace(db, { kind: 'workspace', organizationId: key.scope.organizationId, workspaceId: key.id });
  return entities.get(key);
}
