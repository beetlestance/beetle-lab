import type { FastifyInstance, onRequestAsyncHookHandler } from 'fastify';
import type { WorkspaceScope } from '@beetle/contracts/api';
import type { SuiteStore, SuiteReader } from '../../../../ports/suites.js';
import { mutateSuite, getSuite, getRevision, listSuites, listRevisions } from '../../../../application/suites/index.js';
import { requireRule, sameScope } from '../../../../domain/namespaces/index.js';
import { registerApiOperation } from '../api-route.js';
interface Options { store: SuiteStore; reader: SuiteReader; newId(): string;
 digest(value: string): string; authorize: onRequestAsyncHookHandler }
const scope = (params: { organizationId: string; workspaceId: string }): WorkspaceScope =>
  ({ kind: 'workspace', organizationId: params.organizationId, workspaceId: params.workspaceId });
/** Generated operations behind the existing local pairing/origin/CSRF fence. */
export function registerSuiteRoutes(server: FastifyInstance, options: Options): void {
  if (typeof options.authorize !== 'function') throw new Error('Suite authorization guard required');
  server.register(async scoped => {
    scoped.addHook('onRequest', options.authorize);
    registerApiOperation(scoped, 'listSuites', ({ params, query }) => listSuites({ scope: scope(params), ...query }, options.reader));
    registerApiOperation(scoped, 'getSuite', ({ params }) => getSuite({ scope: scope(params), id: params.suiteId }, options.reader));
    registerApiOperation(scoped, 'listSuiteRevisions', ({ params, query }) => listRevisions({
      scope: scope(params), suiteId: params.suiteId, ...query }, options.reader));
    registerApiOperation(scoped, 'getSuiteRevision', ({ params }) => getRevision({ scope: scope(params), id: params.revisionId }, options.reader));
    registerApiOperation(scoped, 'createSuite', ({ params, body }) => {
      requireRule(sameScope(scope(params), body.scope), 'not_found');
      return mutateSuite({ operation: { kind: 'createSuite', id: options.newId(), request: body }, ...options });
    });
    registerApiOperation(scoped, 'patchSuite', ({ params, body }) => {
      requireRule(sameScope(scope(params), body.scope), 'not_found');
      return mutateSuite({ operation: { kind: 'patchSuite', id: params.suiteId, request: body }, ...options });
    });
    registerApiOperation(scoped, 'createSuiteRevision', ({ params, body }) => {
      requireRule(sameScope(scope(params), body.scope), 'not_found');
      return mutateSuite({ operation: { kind: 'createSuiteRevision', id: options.newId(), suiteId: params.suiteId, request: body }, ...options });
    });
  });
}
