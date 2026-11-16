import type { FastifyInstance, onRequestAsyncHookHandler } from 'fastify';
import type { SettingsReader } from '../../../../ports/settings-reader.js';
import type { SettingsStore } from '../../../../ports/settings.js';
import type { IntentDigest } from '../../../../application/namespaces/index.js';
import { getSettings, patchScopedSettings } from '../../../../application/settings/index.js';
import { registerApiOperation } from '../api-route.js';

export interface SettingsRouteOptions {
  readonly reader: SettingsReader;
  readonly store: SettingsStore;
  readonly digest: IntentDigest;
  /** Required composition-owned session/origin/CSRF guard before body parsing. */
  readonly authorize: onRequestAsyncHookHandler;
}

/** Encapsulated shipped operations; configure API errors/schema compilers first. */
export function registerSettingsRoutes(server: FastifyInstance, options: SettingsRouteOptions): void {
  if (typeof options.authorize !== 'function') throw new Error('Settings authorization guard required');
  const dependencies = Object.freeze({ ...options });
  server.register(async scoped => {
    scoped.addHook('onRequest', dependencies.authorize);
    registerApiOperation(scoped, 'getInstallationSettings', () =>
      getSettings({ kind: 'installation' }, dependencies.reader));
    registerApiOperation(scoped, 'patchInstallationSettings', ({ body }) =>
      patchScopedSettings({ ...dependencies, scope: { kind: 'installation' }, request: body }));
    registerApiOperation(scoped, 'getOrganizationSettings', ({ params }) =>
      getSettings({ kind: 'organization', organizationId: params.organizationId }, dependencies.reader));
    registerApiOperation(scoped, 'patchOrganizationSettings', ({ params, body }) =>
      patchScopedSettings({ ...dependencies, scope: { kind: 'organization', organizationId: params.organizationId }, request: body }));
    registerApiOperation(scoped, 'getWorkspaceSettings', ({ params }) => getSettings({ kind: 'workspace',
      organizationId: params.organizationId, workspaceId: params.workspaceId }, dependencies.reader));
    registerApiOperation(scoped, 'patchWorkspaceSettings', ({ params, body }) => patchScopedSettings({
      ...dependencies, scope: { kind: 'workspace', organizationId: params.organizationId, workspaceId: params.workspaceId }, request: body }));
  });
}
