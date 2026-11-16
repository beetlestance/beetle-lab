import type { FastifyInstance } from 'fastify';
import { getNamespace, listNamespaces, mutateNamespace } from '../../../../application/namespaces/index.js';
import { registerApiOperation } from '../api-route.js';
import type { NamespaceRouteOptions } from './types.js';

export function organizationRoutes(server: FastifyInstance, options: NamespaceRouteOptions): void {
  registerApiOperation(server, 'listOrganizations', ({ query }) =>
    listNamespaces({ kind: 'organization', scope: { kind: 'installation' }, ...query }, options.reader));
  registerApiOperation(server, 'getOrganization', ({ params }) =>
    getNamespace({ kind: 'organization', scope: { kind: 'installation' }, id: params.organizationId }, options.reader));
  registerApiOperation(server, 'createOrganization', ({ body }) => mutateNamespace({
    operation: { kind: 'createOrganization', id: options.newId(), request: body },
    store: options.store, digest: options.digest,
  }));
  registerApiOperation(server, 'patchOrganization', ({ params, body }) => mutateNamespace({
    operation: { kind: 'patchOrganization', id: params.organizationId, request: body },
    store: options.store, digest: options.digest,
  }));
}
