import type { FastifyInstance, onRequestAsyncHookHandler } from 'fastify';
import { ComparisonError } from '../../../../ports/run-comparison.js';
import type { RunComparisonService } from '../../../../ports/run-comparison.js';
import { ApiFault } from '../api-errors.js';
import { registerApiOperation } from '../api-route.js';
import { RequestLifetimes } from '../request-lifetimes/index.js';
interface Options {readonly service: RunComparisonService; readonly authorize: onRequestAsyncHookHandler}
/** Read-only POST retains one physical request owner through service and response settlement. */
export function registerRunComparisonRoutes(server: FastifyInstance, options: Options): {close(): Promise<void>} {
  const owners = new RequestLifetimes(1);
  server.register(async routes => {
    routes.addHook('onRequest', options.authorize); owners.register(routes);
    routes.addHook('preValidation', async request => {
      if (Object.keys(request.query as object).length !== 0) throw new ApiFault('malformed_request');
    });
    registerApiOperation(routes, 'compareRuns', async ({params, body, signal}) => {
      if (body.scope.organizationId.toLowerCase() !== params.organizationId.toLowerCase()
        || body.scope.workspaceId.toLowerCase() !== params.workspaceId.toLowerCase()) throw new ApiFault('forbidden');
      const owner = owners.forSignal(signal);
      try {return await owner.run(() => options.service.compare(body, owner));}
      catch (error) {
        if (!(error instanceof ComparisonError)) throw error;
        switch (error.code) {
          case 'invalid_input': throw new ApiFault('invalid_value');
          case 'conflict': throw new ApiFault('conflict');
          case 'busy': throw new ApiFault('capacity_unavailable');
          default: throw new ApiFault('storage_unavailable');
        }
      }
    }, {bodyLimit: 4096, signalFor: request => owners.forRequest(request).signal});
  });
  let closing: Promise<void> | undefined;
  return Object.freeze({close() {
    const requests = owners.close(); const service = options.service.close();
    closing ??= Promise.all([requests, service]).then(() => undefined); return closing;
  }});
}
