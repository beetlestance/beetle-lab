import type { FastifyInstance, onRequestAsyncHookHandler } from 'fastify';
import type { WorkspaceScope } from '@beetle/contracts/api';
import type { IntentDigest } from '../../../../application/namespaces/index.js';
import { enqueueRun, getRun, listRuns } from '../../../../application/runs/index.js';
import { requireRule, sameScope } from '../../../../domain/namespaces/index.js';
import type { RunReader, RunStore } from '../../../../ports/runs.js';
import { registerApiOperation } from '../api-route.js';

interface Options {
  store: RunStore; reader: RunReader; newId(): string; digest: IntentDigest;
  now(): string; authorize: onRequestAsyncHookHandler;
}
const scope = (params: { organizationId: string; workspaceId: string }): WorkspaceScope =>
  ({ kind: 'workspace', organizationId: params.organizationId, workspaceId: params.workspaceId });

/** Metadata enqueue/read only; no dispatch or execution effects. */
export function registerRunRoutes(server: FastifyInstance, options: Options): void {
  if (typeof options.authorize !== 'function') throw new Error('Run authorization guard required');
  server.register(async scoped => {
    scoped.addHook('onRequest', options.authorize);
    registerApiOperation(scoped, 'listRuns', ({ params, query }) =>
      listRuns({ scope: scope(params), ...query }, options.reader));
    registerApiOperation(scoped, 'getRun', ({ params }) =>
      getRun({ scope: scope(params), id: params.runId }, options.reader));
    registerApiOperation(scoped, 'createRun', ({ params, body }) => {
      requireRule(sameScope(scope(params), body.scope), 'not_found');
      return enqueueRun({ operation: { kind: 'createRun', id: options.newId(), attemptId: options.newId(),
        requestedAt: options.now(), request: body }, digest: options.digest, store: options.store });
    }, { bodyLimit: 65536 });
  });
}
