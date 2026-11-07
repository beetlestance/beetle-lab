import { immutableSnapshot, requireRule, sameScope, sameUuid } from '../../domain/namespaces/index.js';
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

/** Includes operation, route ID, requested ID/root and full request, including scope/version. */
export function prepareNamespaceCommand(operation: NamespaceOperation, digest: IntentDigest): NamespaceCommand {
  const copy = immutableSnapshot(operation);
  const intentDigest = digestMutationIntent(copy, digest);
  return immutableSnapshot({ ...copy, intentDigest });
}

export async function mutateNamespace(input: {
  operation: NamespaceOperation; store: NamespaceStore; digest: IntentDigest;
}): Promise<NamespaceEntity> {
  const command = prepareNamespaceCommand(input.operation, input.digest);
  const result = await input.store.execute(command);
  requireRule(sameUuid(result.id, command.id) && sameScope(result.scope, command.request.scope), 'not_found');
  return immutableSnapshot(result);
}
