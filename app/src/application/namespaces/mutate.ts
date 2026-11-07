import { immutableSnapshot, projectNamespaceIntent, requireRule, sameScope, sameUuid } from '../../domain/namespaces/index.js';
import type {
  NamespaceCommand, NamespaceEntity, NamespaceOperation, NamespaceStore,
} from '../../ports/namespaces.js';

/** Synchronous digest injection: caller supplies SHA-256, never ambient crypto/IDs. */
export type IntentDigest = (canonicalIntent: string) => string;

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`;
}

export function digestMutationIntent(operation: unknown, digest: IntentDigest): string {
  const result = digest(canonical(operation));
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

export async function mutateNamespace(input: {
  operation: NamespaceOperation; store: NamespaceStore; digest: IntentDigest;
}): Promise<NamespaceEntity> {
  const command = prepareNamespaceCommand(input.operation, input.digest);
  const result = await input.store.execute(command);
  requireRule(sameScope(result.scope, command.request.scope) && expectedEntityKind(command, result), 'not_found');
  const intent = projectNamespaceIntent(command);
  // A CREATE receipt carries the original allocation; PATCH always binds the route ID.
  requireRule(!('id' in intent) || sameUuid(result.id, intent.id), 'not_found');
  return immutableSnapshot(result);
}
