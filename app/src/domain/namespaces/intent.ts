import { immutableSnapshot } from './primitives.js';
import type { NamespaceOperation } from './types.js';

/** Client intent only. Allocated CREATE IDs remain on commands, outside this projection.
 * Explicit fields also exclude intentDigest when a storage worker projects a command.
 */
export function projectNamespaceIntent(operation: NamespaceOperation) {
  switch (operation.kind) {
    case 'createOrganization': case 'createWorkspace': case 'createFolder':
      return immutableSnapshot({ kind: operation.kind, request: operation.request });
    case 'patchOrganization': case 'patchWorkspace': case 'patchFolder':
      return immutableSnapshot({ kind: operation.kind, id: operation.id, request: operation.request });
  }
}
