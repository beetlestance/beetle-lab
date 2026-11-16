import type { FastifyInstance } from 'fastify';
import { getNamespace, listNamespaces, mutateNamespace } from '../../../../application/namespaces/index.js';
import { requireRule, sameUuid } from '../../../../domain/namespaces/index.js';
import { registerApiOperation } from '../api-route.js';
import type { NamespaceRouteOptions } from './types.js';

export function workspaceRoutes(server: FastifyInstance, options: NamespaceRouteOptions): void {
  registerApiOperation(server, 'listWorkspaces', ({ params, query }) => listNamespaces({ kind: 'workspace',
    scope: { kind: 'organization', organizationId: params.organizationId }, ...query }, options.reader));
  registerApiOperation(server, 'getWorkspace', ({ params }) => getNamespace({ kind: 'workspace',
    scope: { kind: 'organization', organizationId: params.organizationId }, id: params.workspaceId }, options.reader));
  registerApiOperation(server, 'createWorkspace', ({ params, body }) => {
    requireRule(sameUuid(params.organizationId, body.scope.organizationId), 'not_found');
    return mutateNamespace({ operation: { kind: 'createWorkspace', id: options.newId(),
      rootFolderId: options.newId(), request: body }, store: options.store, digest: options.digest });
  });
  registerApiOperation(server, 'patchWorkspace', ({ params, body }) => {
    requireRule(sameUuid(params.organizationId, body.scope.organizationId), 'not_found');
    return mutateNamespace({ operation: { kind: 'patchWorkspace', id: params.workspaceId, request: body },
      store: options.store, digest: options.digest });
  });
}
