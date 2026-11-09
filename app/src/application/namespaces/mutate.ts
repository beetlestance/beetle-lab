import { encodeCanonicalJson } from '@beetle/contracts';
import { immutableSnapshot, projectNamespaceIntent, requireRule, sameScope, sameUuid } from '../../domain/namespaces/index.js';
import type {
  NamespaceCommand, NamespaceEntity, NamespaceOperation, NamespaceStore,
} from '../../ports/namespaces.js';

/** Synchronous digest injection: caller supplies SHA-256, never ambient crypto/IDs. */
export type IntentDigest = (canonicalIntent: string) => string;
type OperationResult<O extends NamespaceOperation> = O extends { kind: 'createOrganization' | 'patchOrganization' }
  ? Extract<NamespaceEntity, { slug: string }>
  : O extends { kind: 'createWorkspace' | 'patchWorkspace' }
    ? Extract<NamespaceEntity, { rootFolderId: string }>
    : Extract<NamespaceEntity, { parentFolderId: string | null }>;

export function digestMutationIntent(operation: unknown, digest: IntentDigest): string {
  const result = digest(encodeCanonicalJson(operation, 2097152));
  requireRule(/^[a-f0-9]{64}$/.test(result));
  return result;
}

/** CREATE excludes server allocation IDs; PATCH binds route ID and full versioned request. */
export function prepareNamespaceCommand(operation: NamespaceOperation, digest: IntentDigest): NamespaceCommand {
  const copy = immutableSnapshot(operation);
  const intentDigest = digestMutationIntent(projectNamespaceIntent(copy), digest);
  return immutableSnapshot({ ...copy, intentDigest });
}

function expectedEntityKind(operation: NamespaceOperation, result: NamespaceEntity): boolean {
  switch (operation.kind) {
    case 'createOrganization': case 'patchOrganization': return 'slug' in result;
    case 'createWorkspace': case 'patchWorkspace': return 'rootFolderId' in result;
    case 'createFolder': case 'patchFolder': return 'parentFolderId' in result;
  }
}

export async function mutateNamespace<O extends NamespaceOperation>(input: {
  operation: O; store: NamespaceStore; digest: IntentDigest;
}): Promise<OperationResult<O>> {
  const command = prepareNamespaceCommand(input.operation, input.digest);
  const result = await input.store.execute(command);
  requireRule(sameScope(result.scope, command.request.scope) && expectedEntityKind(command, result), 'not_found');
  const intent = projectNamespaceIntent(command);
  // A CREATE receipt carries the original allocation; PATCH always binds the route ID.
  requireRule(!('id' in intent) || sameUuid(result.id, intent.id), 'not_found');
  return immutableSnapshot(result) as OperationResult<O>;
}
