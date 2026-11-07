import type { NamespaceCommand, NamespaceEntity } from '../domain/namespaces/index.js';
export type { NamespaceCommand, NamespaceEntity, NamespaceOperation, NamespaceEvidence, NamespaceChange }
  from '../domain/namespaces/index.js';

/**
 * One short future metadata transaction owns read/decide/check/write/receipt.
 * Before decision: look up (scope, requestId). Same digest returns the
 * original result without rerunning the decision; different digest throws conflict.
 * Intent is projectNamespaceIntent(command): CREATE = {kind, request};
 * PATCH = {kind, id, request}. Full client request includes scope/requestId and
 * PATCH expectedVersion. Generated CREATE id/rootFolderId and intentDigest itself
 * are excluded. Preparation hashes its canonical sorted-key JSON with injected SHA-256.
 * On CREATE replay return the original entity (and workspace rootFolderId), even
 * when command allocation IDs differ. Ignore fresh allocations; create no new root.
 * For a new write use command allocations. Never derive IDs from requestId/digest.
 * Resolve all IDs by exact owner scope; wrong owner yields not_found. Re-read current
 * UUID equality/uniqueness is case-insensitive; persist canonical lowercase UUIDs.
 * version, workspace/root identity, complete <=8 parent chain and exact subtree
 * height (bounded depth aggregate, never all folders) under the SAME write transaction.
 * Invoke decideNamespaceChange locally in the storage worker with that evidence.
 * Check slug and folded sibling-name uniqueness,
 * IDs, owner FKs and expectedVersion atomically, then persist entity/root/receipt.
 * A->B and B->A must serialize and recheck ancestry, not commit preflight evidence.
 * Any error rolls back all changes. Patch IDs, owner scope and rootFolderId cannot
 * change. Existing descendant displayPath is derived on read after a move.
 * No I/O retries on unknown commit; caller may replay the identical request intent.
 * Implementations impose cancellation/busy deadlines outside the pure decision.
 * Only serializable commands/results cross the worker boundary, never a callback.
 */
export interface NamespaceStore {
  execute(command: NamespaceCommand): Promise<NamespaceEntity>;
}
