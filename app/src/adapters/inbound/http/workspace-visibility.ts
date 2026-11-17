import type { onRequestAsyncHookHandler } from 'fastify';
import { apiOperations, validateApi } from '@beetle/contracts/api';
import { ApiFault } from './api-errors.js';
import type { NamespaceReader } from '../../../ports/namespace-reader.js';
const routePath = (name: string) =>
  apiOperations.find((operation) => operation.name === name)!.path.replace(/\{([A-Za-z]+)\}/g, ':$1');
const deletionPath = routePath('deleteWorkspace');
const organizationDeletionPath = routePath('deleteOrganization');
/** Auth first; hides retired organisations and workspaces. An owned read already authorised may finish. */
export function workspaceVisibility(
  authorize: onRequestAsyncHookHandler,
  reader: NamespaceReader,
  historical: boolean,
): onRequestAsyncHookHandler {
  if (historical) return authorize;
  return async function (request, reply) {
    await authorize.call(this, request, reply);
    if (reply.sent) return;
    // Exact DELETE replay belongs to the receipt-first deletion owner, which fences fresh requests itself.
    if (request.method === 'DELETE' && [deletionPath, organizationDeletionPath].includes(request.routeOptions.url!))
      return;
    const params = request.params as Record<string, unknown> | undefined;
    if (!params || typeof params.organizationId !== 'string') return;
    if (typeof params.workspaceId !== 'string') {
      const checked = validateApi('OrganizationParams', { organizationId: params.organizationId });
      if (!checked.ok) throw new ApiFault('malformed_request');
      await reader.get({ kind: 'organization', id: checked.value.organizationId, scope: { kind: 'installation' } });
      return;
    }
    const input = { organizationId: params.organizationId, workspaceId: params.workspaceId };
    const checked = validateApi('WorkspaceParams', input);
    if (!checked.ok) throw new ApiFault('malformed_request');
    await reader.get({
      kind: 'workspace',
      id: checked.value.workspaceId,
      scope: { kind: 'organization', organizationId: checked.value.organizationId },
    });
  };
}
