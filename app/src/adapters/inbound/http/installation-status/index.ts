import type { FastifyInstance, onRequestAsyncHookHandler } from 'fastify';
import {
  engineCatalogue,
  getInstallationStatus,
  getRunQueue,
  getUpgradeStatus,
} from '../../../../application/installation-status/index.js';
import type { UpgradeFacts } from '../../../../application/installation-status/index.js';
import type { AgentStatusView, InstallationStatusReader } from '../../../../ports/installation-status.js';
import { registerApiOperation } from '../api-route.js';

export interface InstallationStatusRouteOptions {
  readonly reader: InstallationStatusReader;
  /** Null when no agent runtime is configured; never triggers agent I/O. */
  readonly agent: () => AgentStatusView | null;
  readonly authorize: onRequestAsyncHookHandler;
  readonly nowMs: () => number;
  readonly upgrade: UpgradeFacts;
}

/** Read-only installation status and run queue reads behind the composition-owned session guard. */
export function registerInstallationStatusRoutes(
  server: FastifyInstance,
  options: InstallationStatusRouteOptions,
): void {
  if (typeof options.authorize !== 'function') throw Error('Installation status authorization required');
  const dependencies = Object.freeze({ ...options });
  server.register(async (scoped) => {
    scoped.addHook('onRequest', dependencies.authorize);
    registerApiOperation(scoped, 'getInstallationStatus', () =>
      getInstallationStatus({ reader: dependencies.reader, agent: dependencies.agent(), nowMs: dependencies.nowMs() }),
    );
    registerApiOperation(scoped, 'listEngines', async () =>
      engineCatalogue(
        await getInstallationStatus({
          reader: dependencies.reader,
          agent: dependencies.agent(),
          nowMs: dependencies.nowMs(),
        }),
      ),
    );
    registerApiOperation(scoped, 'getUpgradeStatus', () =>
      getUpgradeStatus({
        reader: dependencies.reader,
        agent: dependencies.agent(),
        facts: dependencies.upgrade,
        nowMs: dependencies.nowMs(),
      }),
    );
    registerApiOperation(scoped, 'getRunQueue', ({ params }) =>
      getRunQueue(
        {
          scope: { kind: 'workspace', organizationId: params.organizationId, workspaceId: params.workspaceId },
          id: params.runId,
        },
        dependencies.reader,
        dependencies.nowMs(),
      ),
    );
  });
}
