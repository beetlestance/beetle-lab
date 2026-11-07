import type { FastifyInstance } from 'fastify';
import { organizationRoutes } from './organizations.js';
import { workspaceRoutes } from './workspaces.js';
import { folderRoutes } from './folders.js';
import type { NamespaceRouteOptions } from './types.js';
export type { NamespaceRouteOptions } from './types.js';

/** Register after schema compilers; creates no listener or default authentication. */
export function registerNamespaceRoutes(server: FastifyInstance, options: NamespaceRouteOptions): void {
  if (typeof options.authorize !== 'function') throw new Error('Namespace authorization guard required');
  const dependencies = Object.freeze({ ...options });
  server.register(async scoped => {
    scoped.addHook('onRequest', dependencies.authorize);
    organizationRoutes(scoped, dependencies);
    workspaceRoutes(scoped, dependencies);
    folderRoutes(scoped, dependencies);
  });
}
