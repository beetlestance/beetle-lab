import type { FastifyInstance, onRequestAsyncHookHandler } from 'fastify';
import type { RunLiveMetricsService } from '../../../../ports/run-live-metrics.js';
import { registerApiOperation } from '../api-route.js';
import { ApiFault } from '../api-errors.js';
import { RequestLifetimes } from '../request-lifetimes/index.js';
export function registerRunLiveMetricRoutes(server: FastifyInstance, options: {
  service: RunLiveMetricsService; authorize: onRequestAsyncHookHandler;
}): {close(): Promise<void>} {
  const owners = new RequestLifetimes(2, 5000);
  server.register(async routes => {
    routes.addHook('onRequest', options.authorize); owners.register(routes);
    routes.addHook('onRequest', async (request, reply) => {
      const length = request.headers['content-length'];
      if (Object.keys(request.query as object).length || request.headers['transfer-encoding'] !== undefined
        || length !== undefined && length !== '0') throw new ApiFault('malformed_request');
      reply.header('Cache-Control', 'no-store');
    });
    registerApiOperation(routes, 'getRunLiveMetrics', ({params, signal}) => {
      const owner = owners.forSignal(signal);
      return owner.run(() => options.service.reader.getRunLiveMetrics({id: params.runId.toLowerCase(),
        scope: {kind: 'workspace', organizationId: params.organizationId.toLowerCase(), workspaceId: params.workspaceId.toLowerCase()},
        attemptId: params.attemptId.toLowerCase()}, owner));
    }, {signalFor: request => owners.forRequest(request).signal});
  });
  let closing: Promise<void> | undefined;
  return Object.freeze({close() {
    const requests = owners.close(); const service = options.service.close();
    closing ??= Promise.all([requests, service]).then(() => undefined); return closing;
  }});
}
