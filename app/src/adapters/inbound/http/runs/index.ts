import type { FastifyInstance, onRequestAsyncHookHandler } from 'fastify';
import type { WorkspaceScope } from '@beetle/contracts/api';
import type { IntentDigest } from '../../../../application/namespaces/index.js';
import { cancelRun, enqueueRun, getRun, listRuns } from '../../../../application/runs/index.js';
import { requireRule, sameScope } from '../../../../domain/namespaces/index.js';
import type { RunCancellationStore, RunReader, RunStore } from '../../../../ports/runs.js';
import type { RunResultReader } from '../../../../ports/run-results.js';
import type { RunEventReader } from '../../../../ports/run-events.js';
import { getEvents } from './events.js';
import { getResult } from './result.js';
import { registerApiOperation } from '../api-route.js';

interface Options {
  store: RunStore & RunCancellationStore; reader: RunReader; newId(): string; digest: IntentDigest;
  now(): string; authorize: onRequestAsyncHookHandler;
  resultReader?: RunResultReader;
  eventReader?: RunEventReader;
}
const scope = (params: { organizationId: string; workspaceId: string }): WorkspaceScope =>
  ({ kind: 'workspace', organizationId: params.organizationId, workspaceId: params.workspaceId });

/** Metadata enqueue/cancellation/read only; no direct dispatch or engine effects. */
export function registerRunRoutes(server: FastifyInstance, options: Options): void {
  if (typeof options.authorize !== 'function') throw new Error('Run authorization guard required');
  server.register(async scoped => {
    scoped.addHook('onRequest', options.authorize);
    registerApiOperation(scoped, 'listRuns', ({ params, query }) =>
      listRuns({ scope: scope(params), ...query }, options.reader));
    registerApiOperation(scoped, 'getRun', ({ params }) =>
      getRun({ scope: scope(params), id: params.runId }, options.reader));
    registerApiOperation(scoped, 'getRunResult', ({ params }) =>
      getResult({ scope: scope(params), id: params.runId }, options.resultReader));
    registerApiOperation(scoped, 'listRunEvents', ({ params, query }) =>
      getEvents({ scope: scope(params), id: params.runId, ...query }, options.eventReader));
    registerApiOperation(scoped, 'cancelRun', ({ params, body }) => {
      requireRule(sameScope(scope(params), body.scope), 'not_found');
      return cancelRun({ operation: { kind: 'cancelRun', id: params.runId, request: body },
        digest: options.digest, store: options.store });
    }, { bodyLimit: 65536 });
    registerApiOperation(scoped, 'createRun', ({ params, body }) => {
      requireRule(sameScope(scope(params), body.scope), 'not_found');
      return enqueueRun({ operation: { kind: 'createRun', id: options.newId(), attemptId: options.newId(),
        requestedAt: options.now(), request: body }, digest: options.digest, store: options.store });
    }, { bodyLimit: 65536 });
  });
}
