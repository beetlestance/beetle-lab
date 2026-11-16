import type { FastifyInstance } from 'fastify';
import { listNamespaces, mutateNamespace } from '../../../../application/namespaces/index.js';
import { requireRule, sameScope, sameUuid } from '../../../../domain/namespaces/index.js';
import { registerApiOperation } from '../api-route.js';
import type { NamespaceRouteOptions } from './types.js';

export function folderRoutes(server: FastifyInstance, options: NamespaceRouteOptions): void {
  registerApiOperation(server, 'listFolders', ({ params, query }) => listNamespaces({ kind: 'folder',
    scope: { kind: 'workspace', organizationId: params.organizationId, workspaceId: params.workspaceId },
    ...query }, options.reader));
  registerApiOperation(server, 'createFolder', ({ params, body }) => {
    requireRule(sameScope(body.scope, { kind: 'workspace', organizationId: params.organizationId,
      workspaceId: params.workspaceId }), 'not_found');
    return mutateNamespace({ operation: { kind: 'createFolder', id: options.newId(), request: body },
      store: options.store, digest: options.digest });
  });
  registerApiOperation(server, 'patchFolder', ({ params, body }) => {
    requireRule(sameUuid(params.organizationId, body.scope.organizationId), 'not_found');
    return mutateNamespace({ operation: { kind: 'patchFolder', id: params.id, request: body },
      store: options.store, digest: options.digest });
  });
}
