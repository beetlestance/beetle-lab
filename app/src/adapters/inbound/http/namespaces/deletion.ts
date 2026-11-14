import type { FastifyInstance } from 'fastify';
import { deleteNamespace } from '../../../../application/namespace-deletion/index.js';
import { requireRule, sameUuid } from '../../../../domain/namespaces/index.js';
import { registerApiOperation } from '../api-route.js';
import type { NamespaceRouteOptions } from './types.js';
export function namespaceDeletionRoutes(server: FastifyInstance, options: NamespaceRouteOptions): void {
  registerApiOperation(server, 'deleteOrganization', ({params, body}) => {
    if (!options.deletions) throw new Error('Namespace deletion unavailable');
    return deleteNamespace({kind: 'organization', id: params.organizationId, request: body}, options.deletions, options.digest);
  });
  registerApiOperation(server, 'deleteWorkspace', ({params, body}) => {
    requireRule(sameUuid(params.organizationId, body.scope.organizationId), 'not_found');
    if (!options.deletions) throw new Error('Namespace deletion unavailable');
    return deleteNamespace({kind: 'workspace', id: params.workspaceId, request: body}, options.deletions, options.digest);
  });
  registerApiOperation(server, 'deleteFolder', ({params, body}) => {
    requireRule(sameUuid(params.organizationId, body.scope.organizationId), 'not_found');
    if (!options.deletions) throw new Error('Namespace deletion unavailable');
    return deleteNamespace({kind: 'folder', id: params.id, request: body}, options.deletions, options.digest);
  });
}
